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
  /**
   * "YYYY-MM" — the month `currentApiVersion` was last verified as current.
   * Powers the staleness guard (`scheduleFreshness`). Optional: a custom
   * `--schedule` without it simply skips the guard.
   */
  currentApiVersionAsOf?: string;
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

/** Months Salesforce GAs a release (~Feb/Jun/Oct) → a monotonic release counter. */
function releaseOrdinal(year: number, month: number): number {
  const passed = month >= 10 ? 3 : month >= 6 ? 2 : month >= 2 ? 1 : 0;
  return year * 3 + passed;
}

/**
 * Staleness guard for the built-in schedule. Salesforce ships ~3 API versions a
 * year (Spring ≈ Feb, Summer ≈ Jun, Winter ≈ Oct), each +1. Given when
 * `currentApiVersion` was last verified (`currentApiVersionAsOf`, "YYYY-MM"),
 * estimate how many releases have shipped since. A non-zero result means the
 * constant is probably behind and every "distance from current" number here is
 * understated — the one value that silently poisons the whole report if left to
 * rot. Advisory only; returns null when there's nothing to warn about or the
 * schedule carries no asOf date.
 */
export function scheduleFreshness(
  schedule: Schedule,
  now: Date = new Date(),
): { releasesBehind: number; message: string } | null {
  const asOf = schedule.currentApiVersionAsOf?.trim();
  const m = asOf ? /^(\d{4})-(\d{2})$/.exec(asOf) : null;
  if (!m) return null;
  const releasesBehind =
    releaseOrdinal(now.getUTCFullYear(), now.getUTCMonth() + 1) -
    releaseOrdinal(Number(m[1]), Number(m[2]));
  if (releasesBehind < 1) return null;
  const expected = (Number.parseFloat(schedule.currentApiVersion) + releasesBehind).toFixed(1);
  return {
    releasesBehind,
    message:
      `Schedule currentApiVersion is ${schedule.currentApiVersion}, last verified ${asOf}. ` +
      `Salesforce has shipped ~${releasesBehind} release${releasesBehind === 1 ? '' : 's'} since ` +
      `(current is likely ~${expected}), so the drift distances here may be understated. ` +
      `Update idea-almanac, or pass --schedule with a current schedule, before relying on these numbers.`,
  };
}

/**
 * The recommended upgrade target: the lowest API version in the `current` tier.
 * Computed from the schedule, not hardcoded. With currentApiVersion=67 and a
 * current threshold of >= currentApiVersion - 3, this returns 64.0.
 */
export function recommendedFloor(schedule: Schedule): string {
  const current = Math.floor(Number.parseFloat(schedule.currentApiVersion));
  for (let v = 1; v <= current; v++) {
    const t = assignTier({ apiVersion: `${v}.0`, soapLogin: false }, schedule);
    if (t.tier === 'current') return `${v}.0`;
  }
  return schedule.currentApiVersion;
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
