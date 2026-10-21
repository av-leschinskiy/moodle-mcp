/**
 * Тесты слоя MCP: то, что видит хост (регистрация, JSON Schema, annotations,
 * обёртка ответа, маппинг ошибок, вычистка токена).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfig } from './config.js';
import { createServer } from './server.js';
import { FAKE_SITE, FAKE_TOKEN, fakeClient, stubMoodle } from './testing/fake-moodle.js';
import { allTools } from './tools/index.js';

async function connect(): Promise<Client> {
  const server = createServer({ client: fakeClient() });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

beforeEach(() => {
  process.env.MOODLE_URL = FAKE_SITE;
  resetConfig();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('регистрация тулов', () => {
  it('хост видит все тулы из allTools, у каждого описание и объектная схема', async () => {
    const client = await connect();
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(allTools).sort());
    for (const tool of tools) {
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.inputSchema.type, tool.name).toBe('object');
      expect(tool.name).toMatch(/^moodle_/);
    }
    await client.close();
  });

  it('подтверждение хоста — только у записи, видимой студентам', async () => {
    const client = await connect();
    const { tools } = await client.listTools();

    const destructive = tools
      .filter((t) => t.annotations?.destructiveHint === true)
      .map((t) => t.name);
    expect(destructive).toEqual(['moodle_save_grade']);
    expect(tools.find((t) => t.name === 'moodle_save_grade')?.description).toMatch(
      /THE STUDENT WILL SEE/,
    );
    expect(tools.find((t) => t.name === 'moodle_list_submissions')?.annotations).toMatchObject({
      readOnlyHint: true,
    });
    await client.close();
  });
});

describe('ответы и ошибки', () => {
  it('объект уезжает и в text, и в structuredContent', async () => {
    stubMoodle({
      core_webservice_get_site_info: () => ({
        sitename: 'S',
        siteurl: FAKE_SITE,
        userid: 2,
        fullname: 'T',
        functions: [],
      }),
    });
    const client = await connect();

    const result = await client.callTool({ name: 'moodle_site_info', arguments: {} });

    expect(result.structuredContent).toMatchObject({ user: { id: 2 } });
    expect((result.content as { text: string }[])[0]?.text).toContain('"fullname":"T"');
    await client.close();
  });

  it('токен из ответа Moodle вычищается и в text, и в structuredContent', async () => {
    stubMoodle({
      core_webservice_get_site_info: () => ({
        sitename: `S ${FAKE_SITE}/webservice/pluginfile.php/1/a.png?token=${FAKE_TOKEN}`,
        siteurl: FAKE_SITE,
        userid: 2,
        functions: [],
      }),
    });
    const client = await connect();

    const result = await client.callTool({ name: 'moodle_site_info', arguments: {} });

    expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN);
    expect(JSON.stringify(result.structuredContent)).toContain('token=***');
    await client.close();
  });

  it('исключение Moodle приезжает как isError с kind, wsfunction и errorcode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              exception: 'moodle_exception',
              errorcode: 'invalidtoken',
              message: 'Invalid token',
            }),
          ),
      ),
    );
    const client = await connect();

    const result = await client.callTool({ name: 'moodle_list_courses', arguments: {} });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      kind: 'auth',
      wsfunction: 'core_webservice_get_site_info',
      errorcode: 'invalidtoken',
    });
    expect((result.content as { text: string }[])[0]?.text).toContain('moodle-mcp-login');
    await client.close();
  });

  it('невалидный вход отклоняется схемой до вызова API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = await connect();

    const result = await client.callTool({
      name: 'moodle_list_assignments',
      arguments: { courseId: 'abc' },
    });

    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    await client.close();
  });
});
