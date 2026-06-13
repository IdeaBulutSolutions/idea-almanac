/**
 * Minimal env-based LLM provider for the impact narrative, mirroring the
 * corpus stage-3 provider so users configure one thing for the whole project:
 *
 *   ALMANAC_LLM_PROVIDER = claude-cli (default) | copilot | anthropic | cmd
 *   ALMANAC_LLM_MODEL    = optional model override (passed through)
 *   ALMANAC_LLM_CMD      = for provider "cmd": a shell command reading the
 *                          prompt on stdin and writing the answer to stdout
 *   ANTHROPIC_API_KEY    = for provider "anthropic"
 *
 * "copilot" shells out to the GitHub Copilot CLI in programmatic mode
 * (`copilot -p <prompt>`); install it and run `copilot` once to authenticate
 * before using this provider.
 *
 * No provider configured ⇒ the CLI falls back to `--no-llm` bundle output, so
 * nothing ever calls out without the user opting in. This module only runs when
 * the user asked for a model and set the env.
 */
import { spawnSync } from 'node:child_process';
import type { RunModel } from './impact-narrative.js';

export function configuredProvider(): string | null {
  if (process.env.ALMANAC_LLM_PROVIDER) return process.env.ALMANAC_LLM_PROVIDER;
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

export function isProviderConfigured(): boolean {
  return configuredProvider() !== null;
}

function runCli(cmd: string, args: string[], stdin: string): string {
  const res = spawnSync(cmd, args, { input: stdin, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.error) throw res.error;
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
        `unknown ALMANAC_LLM_PROVIDER "${provider}" (have: claude-cli, copilot, anthropic, cmd)`,
      );
  }
}
