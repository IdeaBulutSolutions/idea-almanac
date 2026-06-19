/**
 * Provider selection (offline — nothing is spawned; we only test that the
 * right runner is constructed and misconfiguration fails with a clear message).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { configuredProvider, defaultRunModel, isProviderConfigured } from '../src/analysis/llm.js';

const ENV_KEYS = ['ALMANAC_LLM_PROVIDER', 'ALMANAC_LLM_MODEL', 'ALMANAC_LLM_CMD', 'ANTHROPIC_API_KEY'];
const saved = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('LLM provider selection (env-based)', () => {
  it('no env => no provider => CLI falls back to the --no-llm bundle', () => {
    for (const k of ENV_KEYS) delete process.env[k];
    expect(configuredProvider()).toBeNull();
    expect(isProviderConfigured()).toBe(false);
  });

  it('ANTHROPIC_API_KEY alone does not auto-select the remote anthropic provider', () => {
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.ANTHROPIC_API_KEY = 'sk-ant-fake';
    // Key must not silently opt the user into a remote provider — explicit
    // ALMANAC_LLM_PROVIDER=anthropic is required.
    expect(configuredProvider()).toBeNull();
    expect(isProviderConfigured()).toBe(false);
  });

  it('anthropic provider prints an egress warning to stderr when runner is built', () => {
    process.env.ALMANAC_LLM_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-fake';
    const chunks: string[] = [];
    const orig = process.stderr.write.bind(process.stderr);
    // @ts-expect-error — patching write for test observability
    process.stderr.write = (chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    };
    try {
      defaultRunModel(); // warning fires here, before any prompt is sent
    } finally {
      process.stderr.write = orig;
    }
    const warn = chunks.join('');
    expect(warn).toContain('api.anthropic.com');
    expect(warn).toContain('claude-cli');
  });

  it('supports copilot as a first-class provider (pre-launch requirement)', () => {
    process.env.ALMANAC_LLM_PROVIDER = 'copilot';
    expect(configuredProvider()).toBe('copilot');
    // Constructing the runner must not spawn anything or throw.
    expect(typeof defaultRunModel()).toBe('function');
  });

  it('supports cursor (cursor-agent) as a first-class provider', () => {
    process.env.ALMANAC_LLM_PROVIDER = 'cursor';
    expect(configuredProvider()).toBe('cursor');
    expect(typeof defaultRunModel()).toBe('function');
  });

  it('unknown provider error lists every supported provider', () => {
    process.env.ALMANAC_LLM_PROVIDER = 'gemini-9000';
    expect(() => defaultRunModel()).toThrow(/claude-cli, copilot, cursor, anthropic, cmd/);
  });

  it('provider cmd without ALMANAC_LLM_CMD fails with a clear message', () => {
    process.env.ALMANAC_LLM_PROVIDER = 'cmd';
    delete process.env.ALMANAC_LLM_CMD;
    expect(() => defaultRunModel()).toThrow(/ALMANAC_LLM_CMD/);
  });
});
