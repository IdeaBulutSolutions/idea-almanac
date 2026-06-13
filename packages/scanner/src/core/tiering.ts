/**
 * Tiering. Rules live in retirement-schedule.json — data, not
 * code. First matching rule wins, top to bottom. Match expressions are
 * evaluated by a tiny purpose-built evaluator (no eval, no deps) supporting
 * exactly what schedule rules need:
 *
 *   identifiers : apiVersion, currentApiVersion, soapLogin
 *   operators   : <= < >= > == != && || + - ( )
 *   special     : the literal match "else" always matches
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ScheduleRule {
  tier: string;
  match: string;
  date?: string;
  label?: string;
  severity?: 'critical' | 'high' | 'medium' | 'info';
  weight?: number;
}

export interface Schedule {
  description?: string;
  currentApiVersion: string;
  rules: ScheduleRule[];
}

export interface TierResult {
  tier: string;
  label?: string;
  date?: string;
  severity?: 'critical' | 'high' | 'medium' | 'info';
  weight: number;
}

export interface TierContext {
  apiVersion: number;
  currentApiVersion: number;
  soapLogin: boolean;
}

const DEFAULT_SCHEDULE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'retirement-schedule.json',
);

export function loadSchedule(path: string = DEFAULT_SCHEDULE_PATH): Schedule {
  const schedule = JSON.parse(readFileSync(path, 'utf8')) as Schedule;
  if (!schedule.currentApiVersion || !Array.isArray(schedule.rules)) {
    throw new Error(`Invalid retirement schedule: ${path}`);
  }
  return schedule;
}

/** Assign the first matching rule. `apiVersion: null` => tier "unknown" (weight 0). */
export function assignTier(
  item: { apiVersion: string | null; soapLogin?: boolean },
  schedule: Schedule,
): TierResult {
  if (item.apiVersion === null) {
    return { tier: 'unknown', weight: 0 };
  }
  const ctx: TierContext = {
    apiVersion: Number.parseFloat(item.apiVersion),
    currentApiVersion: Number.parseFloat(schedule.currentApiVersion),
    soapLogin: item.soapLogin ?? false,
  };
  for (const rule of schedule.rules) {
    if (rule.match === 'else' || evaluate(rule.match, ctx)) {
      return {
        tier: rule.tier,
        label: rule.label,
        date: rule.date,
        severity: rule.severity,
        weight: rule.weight ?? 0,
      };
    }
  }
  return { tier: 'unknown', weight: 0 };
}

// ---------------------------------------------------------------------------
// Expression evaluator
// ---------------------------------------------------------------------------

type Token = string;

function tokenize(src: string): Token[] {
  const re = /\s*(&&|\|\||<=|>=|==|!=|<|>|\(|\)|\+|-|[A-Za-z_][A-Za-z0-9_]*|[0-9]+(?:\.[0-9]+)?)/y;
  const tokens: Token[] = [];
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m || m[1] === undefined) {
      if (src.slice(pos).trim() === '') break;
      throw new Error(`Bad schedule expression near "${src.slice(pos)}" in: ${src}`);
    }
    tokens.push(m[1]);
    pos = re.lastIndex;
  }
  return tokens;
}

export function evaluate(expr: string, ctx: TierContext): boolean {
  const tokens = tokenize(expr);
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];

  function primary(): number | boolean {
    const t = next();
    if (t === undefined) throw new Error(`Unexpected end of expression: ${expr}`);
    if (t === '(') {
      const v = or();
      if (next() !== ')') throw new Error(`Missing ")" in: ${expr}`);
      return v;
    }
    if (/^[0-9]/.test(t)) return Number.parseFloat(t);
    if (t === 'apiVersion') return ctx.apiVersion;
    if (t === 'currentApiVersion') return ctx.currentApiVersion;
    if (t === 'soapLogin') return ctx.soapLogin;
    if (t === 'true') return true;
    if (t === 'false') return false;
    throw new Error(`Unknown identifier "${t}" in: ${expr}`);
  }

  function additive(): number | boolean {
    let left = primary();
    while (peek() === '+' || peek() === '-') {
      const op = next();
      const right = primary();
      if (typeof left !== 'number' || typeof right !== 'number') {
        throw new Error(`Arithmetic on non-number in: ${expr}`);
      }
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function comparison(): number | boolean {
    const left = additive();
    const op = peek();
    if (op === '<=' || op === '<' || op === '>=' || op === '>' || op === '==' || op === '!=') {
      next();
      const right = additive();
      switch (op) {
        case '<=': return Number(left) <= Number(right);
        case '<': return Number(left) < Number(right);
        case '>=': return Number(left) >= Number(right);
        case '>': return Number(left) > Number(right);
        case '==': return left === right;
        case '!=': return left !== right;
      }
    }
    return left;
  }

  function and(): number | boolean {
    let left = comparison();
    while (peek() === '&&') {
      next();
      const right = comparison();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  function or(): number | boolean {
    let left = and();
    while (peek() === '||') {
      next();
      const right = and();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  const result = or();
  if (i !== tokens.length) throw new Error(`Trailing tokens in: ${expr}`);
  return Boolean(result);
}
