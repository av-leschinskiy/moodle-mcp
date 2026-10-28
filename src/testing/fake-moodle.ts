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

/** Ключ обработчика загрузки в `webservice/upload.php` (не функция API). */
export const UPLOAD = 'webservice/upload.php';

export interface RecordedCall {
  wsfunction: string;
  params: Record<string, string>;
  /** Адрес запроса: по нему тест видит, что токена в URL нет. */
  url: string;
  /** Пришёл ли верный токен полем тела (`wstoken` или `token`). */
  tokenInBody: boolean;
  /** Файл из multipart-тела загрузки. */
  file?: { name: string; type: string; size: number; bytes: Uint8Array };
}

type Handler = (params: Record<string, string>, call: RecordedCall) => unknown;

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
 * так тест падает с понятным текстом, а не на undefined. Загрузка в
 * `webservice/upload.php` идёт в обработчик `UPLOAD` с полями формы и файлом.
 */
export function stubMoodle(handlers: Record<string, Handler>): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (init?.body instanceof FormData) {
        const params: Record<string, string> = {};
        let file: RecordedCall['file'];
        for (const [key, value] of init.body) {
          if (typeof value !== 'string') {
            const bytes = new Uint8Array(await value.arrayBuffer());
            file = { name: value.name, type: value.type, size: value.size, bytes };
          } else if (key !== 'token') {
            params[key] = value;
          }
        }
        const call: RecordedCall = {
          wsfunction: UPLOAD,
          params,
          url: String(url),
          tokenInBody: init.body.get('token') === FAKE_TOKEN,
          ...(file ? { file } : {}),
        };
        calls.push(call);
        const handler = handlers[UPLOAD];
        if (!handler) return jsonResponse({ error: 'no stub for upload', errorcode: 'nohandler' });
        return jsonResponse(handler(params, call));
      }
      const body = new URLSearchParams(String(init?.body ?? ''));
      const wsfunction = body.get('wsfunction') ?? '';
      const params: Record<string, string> = {};
      for (const [key, value] of body) {
        if (!['wstoken', 'wsfunction', 'moodlewsrestformat'].includes(key)) params[key] = value;
      }
      calls.push({
        wsfunction,
        params,
        url: String(url),
        tokenInBody: body.get('wstoken') === FAKE_TOKEN,
      });
      const handler = handlers[wsfunction];
      if (!handler) {
        return jsonResponse({
          exception: 'moodle_exception',
          errorcode: 'nohandler',
          message: `no stub for ${wsfunction}`,
        });
      }
      return jsonResponse(handler(params, calls[calls.length - 1]!));
    }),
  );
  return calls;
}
