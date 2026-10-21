import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { resetConfig } from '../config.js';
import { log, setLogServer } from './logger.js';

const sent: { level: string; data: unknown }[] = [];

/** Минимальный дублёр сервера: интересует только то, что до него доехало. */
function fakeServer(): McpServer {
  return {
    sendLoggingMessage: async (params: { level: string; data: unknown }) => {
      sent.push(params);
    },
  } as unknown as McpServer;
}

beforeEach(() => {
  sent.length = 0;
  process.env.MOODLE_URL = 'https://moodle.example';
  delete process.env.MOODLE_DEBUG;
  resetConfig();
  setLogServer(fakeServer());
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('log: что уходит хосту', () => {
  it('info уходит хосту даже без MOODLE_DEBUG — уровнем управляет хост', async () => {
    log('info', 'core_webservice_get_site_info');
    await Promise.resolve();

    expect(sent.map((m) => m.level)).toEqual(['info']);
  });

  it('warning и error уходят всегда', async () => {
    log('warning', 'drift');
    log('error', 'boom');
    await Promise.resolve();

    expect(sent.map((m) => m.level)).toEqual(['warning', 'error']);
  });

  it('debug придерживается до MOODLE_DEBUG: это наш внутренний шум, не сигнал хосту', async () => {
    log('debug', 'подробности');
    await Promise.resolve();
    expect(sent).toHaveLength(0);

    process.env.MOODLE_DEBUG = '1';
    resetConfig();
    log('debug', 'подробности');
    await Promise.resolve();
    expect(sent.map((m) => m.level)).toEqual(['debug']);
  });

  it('в stderr info попадает только при MOODLE_DEBUG', () => {
    log('info', 'тихо');
    expect(console.error).not.toHaveBeenCalled();

    process.env.MOODLE_DEBUG = '1';
    resetConfig();
    log('info', 'громко');
    expect(console.error).toHaveBeenCalled();
  });
});
