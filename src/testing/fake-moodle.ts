/**
 * Подставной Moodle для тестов: подменяет глобальный `fetch` и отвечает по
 * имени `wsfunction` из тела запроса. Все данные синтетические — ни реальных
 * сайтов, ни реальных людей.
 *
 * Лежит вне `*.test.ts`, поэтому из сборки исключён явно (`tsconfig.json`).
 */

import { vi } from 'vitest';
import { MoodleClient } from '../api/moodle-client.js';

export const FAKE_SITE = 'https://moodle.example.org';
export const FAKE_TOKEN = 'faketoken0123456789abcdef';

export interface RecordedCall {
  wsfunction: string;
  params: Record<string, string>;
}

type Handler = (params: Record<string, string>) => unknown;

export function fakeClient(): MoodleClient {
  return new MoodleClient({
    siteUrl: FAKE_SITE,
    getToken: async () => FAKE_TOKEN,
    timeoutMs: 2000,
    retries: 0,
  });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Ставит fetch-заглушку. Неизвестная функция отвечает исключением Moodle —
 * так тест падает с понятным текстом, а не на undefined.
 */
export function stubMoodle(handlers: Record<string, Handler>): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body ?? ''));
      const wsfunction = body.get('wsfunction') ?? '';
      const params: Record<string, string> = {};
      for (const [key, value] of body) {
        if (!['wstoken', 'wsfunction', 'moodlewsrestformat'].includes(key)) params[key] = value;
      }
      calls.push({ wsfunction, params });
      const handler = handlers[wsfunction];
      if (!handler) {
        return jsonResponse({
          exception: 'moodle_exception',
          errorcode: 'nohandler',
          message: `no stub for ${wsfunction}`,
        });
      }
      return jsonResponse(handler(params));
    }),
  );
  return calls;
}
