/**
 * Minimal env-based LLM provider for the impact narrative, mirroring the
 * corpus stage-3 provider so users configure one thing for the whole project:
 *
 *   ALMANAC_LLM_PROVIDER   = claude-cli (default) | copilot | cursor | anthropic | cmd
 *   ALMANAC_LLM_MODEL      = optional model override (passed through)
 *   ALMANAC_LLM_CMD        = for provider "cmd": a shell command reading the
 *                            prompt on stdin and writing the answer to stdout
 *   ALMANAC_LLM_TIMEOUT_MS = max time for any one model call (default 600000 =
 *                            10 min); guards against a CLI that hangs
 *   ANTHROPIC_API_KEY      = for provider "anthropic"
 *
 * "copilot" shells out to the GitHub Copilot CLI (`copilot -p <prompt>`);
 * "cursor" shells out to the Cursor CLI in headless mode
 * (`cursor-agent -p <prompt> --output-format text`). Install + authenticate the
 * respective CLI once before use.
 *
 * No provider configured ⇒ the CLI falls back to `--no-llm` bundle output, so
 * nothing ever calls out without the user opting in. This module only runs when
 * the user asked for a model and set the env.
 */
import { spawnSync } from 'node:child_process';
import type { RunModel } from './impact-narrative.js';

/** Per-call timeout (ms). Some agent CLIs can hang in headless mode; never wait forever. */
const TIMEOUT_MS = Number.parseInt(process.env.ALMANAC_LLM_TIMEOUT_MS ?? '', 10) || 600_000;

export function configuredProvider(): string | null {
  if (process.env.ALMANAC_LLM_PROVIDER) return process.env.ALMANAC_LLM_PROVIDER;
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

export function isProviderConfigured(): boolean {
  return configuredProvider() !== null;
}

function runCli(cmd: string, args: string[], stdin: string): string {
  const res = spawnSync(cmd, args, {
    input: stdin,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: TIMEOUT_MS,
  });
  // A timeout (or any kill signal) surfaces as a clear message, never a hang.
  if (res.error) {
    const e = res.error as NodeJS.ErrnoException;
    if (e.code === 'ETIMEDOUT') {
      throw new Error(
        `${cmd} timed out after ${TIMEOUT_MS}ms — set ALMANAC_LLM_TIMEOUT_MS to allow longer, ` +
          `or try a smaller --limit.`,
      );
    }
    throw res.error;
  }
  if (res.signal) {
    throw new Error(
      `${cmd} was killed (${res.signal}) — likely the ${TIMEOUT_MS}ms timeout; ` +
        `raise ALMANAC_LLM_TIMEOUT_MS or use a smaller --limit.`,
    );
  }
  if (res.status !== 0) {
    throw new Error(`${cmd} exited ${res.status}: ${(res.stderr || '').toString().slice(0, 500)}`);
  }
  return res.stdout;
}

/** Build the configured model runner, or throw a clear message if unusable. */
export function defaultRunModel(): RunModel {
  const provider = configuredProvider() ?? 'claude-cli';
  const model = process.env.ALMANAC_LLM_MODEL ?? '';
  switch (provider) {
    case 'claude-cli':
      return (prompt) =>
        runCli('claude', ['-p', '--output-format', 'text', ...(model ? ['--model', model] : [])], prompt);
    case 'copilot':
      // GitHub Copilot CLI programmatic mode. The prompt travels as an argv
      // argument (Copilot CLI reads -p, not stdin); bundles are tens of KB,
      // comfortably under argv limits. No tool permissions are granted, so
      // Copilot can only answer — it cannot touch files or run commands.
      return (prompt) =>
        runCli('copilot', ['-p', prompt, ...(model ? ['--model', model] : [])], '');
    case 'cursor':
      // Cursor CLI headless/print mode. Prompt as an argv argument; force text
      // output. No --force, so the agent can only answer — it never edits files.
      return (prompt) =>
        runCli(
          'cursor-agent',
          ['-p', prompt, '--output-format', 'text', ...(model ? ['--model', model] : [])],
          '',
        );
    case 'cmd': {
      const cmd = process.env.ALMANAC_LLM_CMD;
      if (!cmd) throw new Error('provider "cmd" needs ALMANAC_LLM_CMD set');
      return (prompt) => runCli('bash', ['-c', cmd], prompt);
    }
    case 'anthropic':
      return (prompt) => {
        const key = process.env.ANTHROPIC_API_KEY;
        if (!key) throw new Error('ANTHROPIC_API_KEY not set');
        const body = JSON.stringify({
          model: model || 'claude-sonnet-4-6',
          max_tokens: 8192,
          messages: [{ role: 'user', content: prompt }],
        });
        const res = runCli(
          'curl',
          [
            '-sS',
            'https://api.anthropic.com/v1/messages',
            '-H',
            `x-api-key: ${key}`,
            '-H',
            'anthropic-version: 2023-06-01',
            '-H',
            'content-type: application/json',
            '-d',
            '@-',
          ],
          body,
        );
        const parsed = JSON.parse(res) as { content?: { text?: string }[] };
        return parsed.content?.map((c) => c.text ?? '').join('') ?? '';
      };
    default:
      throw new Error(
        `unknown ALMANAC_LLM_PROVIDER "${provider}" (have: claude-cli, copilot, cursor, anthropic, cmd)`,
      );
  }
}
