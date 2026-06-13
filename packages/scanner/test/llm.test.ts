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
