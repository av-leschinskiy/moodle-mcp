/**
 * Moodle MCP Server
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { z } from 'zod';
import {
  createMoodleClientFromConfig,
  MoodleRequestError,
  runWithClient,
  scrub,
  type MoodleClient,
  type MoodleErrorKind,
} from './api/moodle-client.js';
import { getConfig } from './config.js';
import { allTools } from './tools/index.js';
import type { ToolDef } from './tools/types.js';
import { log, setLogServer } from './utils/logger.js';
import { VERSION, BASE_COMMIT_SHORT, BUILD_DATE, PACKAGE_NAME } from './version.js';

// Подмешивается в системный промпт модели хостом. Должно быть компактно —
// каждый токен идёт в КАЖДЫЙ запрос. Конкретику по параметрам пишем в
// .describe() Zod-схем.
const SERVER_INSTRUCTIONS = [
  'Moodle MCP server for teachers: courses, assignments (mod_assign), student submissions, grading.',
  '',
  'Typical grading flow: moodle_list_courses → moodle_list_assignments(courseId) →',
  'moodle_list_submissions(assignmentId, status=needs_attention) → moodle_get_submission →',
  'moodle_download_file for files. assignmentId is the assignment id field, not the cmid from the URL.',
  'What needs the teacher across a whole course: moodle_list_pending_submissions(courseId).',
  '',
  'moodle_save_grade, moodle_add_submission_comment and moodle_revert_submission_to_draft',
  'change what the student sees: call them only after the teacher has explicitly confirmed',
  'the action and its text.',
].join('\n');

/**
 * Потолок на текстовый блок ответа. Спека просит дублировать
 * `structuredContent` сериализованным JSON в TextContent, и именно его хосты
 * кладут в контекст модели; список участников большого курса легко съедает
 * окно. Текст режем, `structuredContent` оставляем полным.
 */
const MAX_TEXT_CHARS = 100_000;

function capText(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text;
  return (
    text.slice(0, MAX_TEXT_CHARS) +
    `\n…truncated ${text.length - MAX_TEXT_CHARS} of ${text.length} chars. ` +
    'Narrow the request (status filter) or use structuredContent.'
  );
}

/** Род ошибки в ответе тула: транспортные виды клиента плюс `internal` — сбой в самом туле. */
type ToolErrorKind = MoodleErrorKind | 'internal';

function describeError(error: unknown): string {
  return scrub(error instanceof Error ? error.message : String(error));
}

function titleFromName(name: string): string {
  return `Moodle · ${name.replace(/^moodle_/, '').replace(/_/g, ' ')}`;
}

/**
 * Результат тула → объект для `structuredContent` с вычищенными токенами.
 *
 * Последний рубеж: клиент и тулы токен в ответ не кладут, но ответ Moodle мог
 * процитировать ссылку с `token=` (в тексте сдачи, в описании задания), и
 * наружу она уйти не должна. `scrub` не трогает кавычки, поэтому JSON после
 * замены остаётся валидным.
 */
function toStructured(result: unknown): Record<string, unknown> {
  const safe = JSON.parse(scrub(JSON.stringify(result ?? null))) as unknown;
  // MCP-спека требует, чтобы structuredContent был JSON-object (record).
  if (Array.isArray(safe)) return { items: safe };
  if (safe && typeof safe === 'object') return safe as Record<string, unknown>;
  return { value: safe };
}

export interface CreateServerOptions {
  client?: MoodleClient;
}

export function createServer(options?: CreateServerOptions): McpServer {
  // Единственный способ инъекции — ALS через runWithClient ниже.
  const serverClient: MoodleClient = options?.client ?? createMoodleClientFromConfig();

  const server = new McpServer(
    { name: PACKAGE_NAME, version: `${VERSION}+${BASE_COMMIT_SHORT}`, title: 'Moodle' },
    {
      capabilities: { tools: {}, logging: {} },
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  setLogServer(server);

  const tools = allTools as Record<string, ToolDef<z.ZodTypeAny>>;
  for (const [name, tool] of Object.entries(tools)) {
    if (tool.disabled) {
      log('info', `Tool ${name} is disabled, skipping registration`);
      continue;
    }
    const annotations = { openWorldHint: true, title: titleFromName(name), ...tool.annotations };

    server.registerTool(
      name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        annotations,
      },
      async (args, ctx) => {
        try {
          const result = await runWithClient(serverClient, () => tool.execute(args, ctx?.signal));
          const structuredContent = toStructured(result);
          return {
            content: [{ type: 'text' as const, text: capText(JSON.stringify(structuredContent)) }],
            structuredContent,
          };
        } catch (error) {
          const errorMessage = describeError(error);
          log('error', `Tool ${name} failed:`, errorMessage);
          const structured: { isError: true; kind: ToolErrorKind; message: string } & Record<
            string,
            unknown
          > =
            error instanceof MoodleRequestError
              ? {
                  isError: true as const,
                  kind: error.kind,
                  wsfunction: error.wsfunction,
                  errorcode: error.errorcode ?? null,
                  statusCode: error.statusCode ?? null,
                  message: errorMessage,
                }
              : { isError: true as const, kind: 'internal' as const, message: errorMessage };
          return {
            content: [{ type: 'text' as const, text: errorMessage }],
            structuredContent: structured,
            isError: true,
          };
        }
      },
    );
  }

  return server;
}

export async function runServer(): Promise<void> {
  // Конфиг читаем до создания сервера: невалидный env должен остановить старт,
  // а не всплыть первым же вызовом тула. Код выхода решает `src/index.ts`.
  getConfig();

  const server = createServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
  log('info', `Moodle MCP server started v${VERSION}+${BASE_COMMIT_SHORT} (built ${BUILD_DATE})`);

  // Обработчик синхронный: async-функция в `process.on` превратила бы отказ
  // `close()` в unhandled rejection и код выхода runtime-краха.
  const shutdown = (): void => {
    void server
      .close()
      .catch((error: unknown) => {
        log('error', `Failed to close transport: ${describeError(error)}`);
      })
      .finally(() => {
        process.exit(0);
      });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
