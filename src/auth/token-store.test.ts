import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetConfig } from '../config.js';
import { getToken, readToken, writeToken } from './token-store.js';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'moodle-mcp-test-'));
  file = join(dir, 'sub', 'token.json');
  process.env.MOODLE_URL = 'https://moodle.example.org';
  process.env.MOODLE_TOKEN_FILE = file;
  delete process.env.MOODLE_TOKEN;
  resetConfig();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.MOODLE_TOKEN_FILE;
});

describe('token-store', () => {
  it('пишет файл 0600 в формате {site, token, privatetoken} и читает обратно', async () => {
    await writeToken(file, { site: 'https://moodle.example.org', token: 't1', privatetoken: 'p1' });

    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      site: 'https://moodle.example.org',
      token: 't1',
      privatetoken: 'p1',
    });
    expect(await readToken(file)).toMatchObject({ token: 't1' });
  });

  it('нет файла — null', async () => {
    expect(await readToken(file)).toBeNull();
  });

  it('битый файл — ошибка с подсказкой и без содержимого файла', async () => {
    await writeToken(file, { site: 'https://moodle.example.org', token: 't1' });
    await writeFile(file, '{"site":"x","token":"leaky-secret-value"');

    const err = (await readToken(file).catch((e: unknown) => e)) as Error;
    expect(err.message).toContain('moodle-mcp-login');
    expect(err.message).not.toContain('leaky-secret-value');
  });
});

describe('getToken', () => {
  it('берёт токен из файла, если сайт совпал (слэш на конце не мешает)', async () => {
    await writeToken(file, { site: 'https://moodle.example.org/', token: 'from-file' });
    expect(await getToken()).toBe('from-file');
  });

  it('сайт в файле не совпал с MOODLE_URL — просит перелогиниться', async () => {
    await writeToken(file, { site: 'https://other.example.org', token: 'from-file' });
    const err = (await getToken().catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/other\.example\.org.*moodle-mcp-login/s);
    expect(err.message).not.toContain('from-file');
  });

  it('нет файла — просит залогиниться', async () => {
    await expect(getToken()).rejects.toThrow(/moodle-mcp-login/);
  });

  it('MOODLE_TOKEN перекрывает файл', async () => {
    process.env.MOODLE_TOKEN = 'from-env';
    resetConfig();
    expect(await getToken()).toBe('from-env');
    delete process.env.MOODLE_TOKEN;
  });
});
