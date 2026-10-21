import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConfig, isDebugRequested, resetConfig } from './config.js';

const saved = { ...process.env };

beforeEach(() => {
  for (const key of Object.keys(process.env))
    if (key.startsWith('MOODLE_')) delete process.env[key];
  resetConfig();
});

afterEach(() => {
  process.env = { ...saved };
  resetConfig();
});

describe('getConfig', () => {
  it('без MOODLE_URL не стартует', () => {
    expect(() => getConfig()).toThrow(/MOODLE_URL/);
  });

  it('нормализует адрес и подставляет дефолты', () => {
    process.env.MOODLE_URL = 'https://moodle.example.org/';
    const cfg = getConfig();
    expect(cfg.MOODLE_URL).toBe('https://moodle.example.org');
    expect(cfg.MOODLE_TIMEOUT).toBe(30_000);
    expect(cfg.MOODLE_TOKEN_FILE).toMatch(/\.config\/mcp-moodle\/token\.json$/);
    expect(cfg.MOODLE_TOKEN).toBeUndefined();
    expect(cfg.MOODLE_DEBUG).toBe(false);
  });

  it('пустые строки считаются незаданными (так их подставляют MCP-реестры)', () => {
    process.env.MOODLE_URL = 'https://moodle.example.org';
    process.env.MOODLE_TIMEOUT = '';
    process.env.MOODLE_TOKEN = ' ';
    expect(getConfig().MOODLE_TIMEOUT).toBe(30_000);
    expect(getConfig().MOODLE_TOKEN).toBeUndefined();
  });

  it('невалидный таймаут — понятная ошибка', () => {
    process.env.MOODLE_URL = 'https://moodle.example.org';
    process.env.MOODLE_TIMEOUT = 'abc';
    expect(() => getConfig()).toThrow(/MOODLE_TIMEOUT/);
  });

  it('значение MOODLE_TOKEN не попадает в текст ошибки конфигурации', () => {
    process.env.MOODLE_URL = 'not-a-url';
    process.env.MOODLE_TOKEN = 'secret-env-token';
    expect(() => getConfig()).toThrow(/MOODLE_URL/);
    try {
      getConfig();
    } catch (err) {
      expect((err as Error).message).not.toContain('secret-env-token');
    }
  });
});

describe('isDebugRequested', () => {
  it('понимает 1/true/yes/on и не падает на прочем', () => {
    expect(isDebugRequested('1')).toBe(true);
    expect(isDebugRequested('ON')).toBe(true);
    expect(isDebugRequested('false')).toBe(false);
    expect(isDebugRequested(undefined)).toBe(false);
  });
});
