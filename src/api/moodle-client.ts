/**
 * Клиент REST API веб-сервисов Moodle.
 *
 * Все функции зовутся одинаково: POST `<site>/webservice/rest/server.php` с
 * `wstoken`, `wsfunction`, `moodlewsrestformat=json` и параметрами в
 * form-кодировании Moodle (`ids[0]=5`, `plugindata[x][text]=…`). Ошибку
 * функции Moodle отдаёт статусом 200 с телом `{exception, errorcode, message}` —
 * поэтому успех определяется по телу, а не по HTTP.
 *
 * Файлы сдач лежат за `<site>/webservice/pluginfile.php/…?token=`. Токен
 * живёт в URL запроса, поэтому всё, что уходит наружу (ошибки, логи, ответы
 * тулов), прогоняется через `scrub`.
 *
 * Ретраи — только для чтения (network/timeout/5xx/429). Вызов с
 * `mutation: true` не повторяется: оценка не должна записаться дважды.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { getToken } from '../auth/token-store.js';
import { getConfig } from '../config.js';
import { log } from '../utils/logger.js';

export interface MoodleClientConfig {
  /** wwwroot сайта без завершающего слэша. */
  siteUrl: string;
  /** Токен веб-сервиса; зовётся на каждый запрос. */
  getToken: () => Promise<string>;
  timeoutMs?: number;
  /** Повторы на transient-ошибках чтения. Default: 2. Шов для тестов. */
  retries?: number;
}

/**
 * Род ошибки:
 *  - `network` — сеть, таймаут;
 *  - `http` — HTTP не 2xx;
 *  - `parse` — тело не JSON;
 *  - `auth` — токен не принят (нужен перелогин);
 *  - `moodle` — функция вернула исключение (нет прав, неверный параметр…).
 */
export type MoodleErrorKind = 'network' | 'http' | 'parse' | 'auth' | 'moodle';

export class MoodleRequestError extends Error {
  readonly kind: MoodleErrorKind;
  readonly wsfunction: string;
  readonly errorcode: string | undefined;
  readonly statusCode: number | undefined;

  // Поля объявлены явно: tsconfig держит `erasableSyntaxOnly`.
  constructor(
    kind: MoodleErrorKind,
    wsfunction: string,
    message: string,
    extra?: { errorcode?: string | undefined; statusCode?: number | undefined; cause?: unknown },
  ) {
    super(`${wsfunction}: ${message}`, { cause: extra?.cause });
    this.name = 'MoodleRequestError';
    this.kind = kind;
    this.wsfunction = wsfunction;
    this.errorcode = extra?.errorcode;
    this.statusCode = extra?.statusCode;
  }
}

/**
 * Коды исключений Moodle, означающие «токен не годится». Остальные коды —
 * обычные ошибки функции: перелогин их не лечит, и советовать его нельзя.
 */
const AUTH_ERROR_CODES = new Set(['invalidtoken', 'accessexception', 'expiredtoken']);

const LOGIN_HINT = 'Выполните: npx moodle-mcp-login';

/**
 * Вычищает токены из строки: параметры `token`/`wstoken`/`privatetoken` в URL
 * и формах, а
 * также конкретное значение токена, если оно известно, — на случай, если
 * Moodle процитирует его в тексте ошибки.
 */
export function scrub(text: string, token?: string): string {
  let out = text.replace(/((?:^|[^a-z0-9_])(?:ws|private)?token=)[^&\s"'<>\\]+/gi, '$1***');
  if (token && token.length >= 8) out = out.split(token).join('***');
  return out;
}

/** Скалярное значение параметра Moodle. Булевы уходят как 1/0 — так их ждёт PHP. */
export type MoodleScalar = string | number | boolean;
export type MoodleParams = { [key: string]: MoodleParamValue };
export type MoodleParamValue = MoodleScalar | null | undefined | MoodleParamValue[] | MoodleParams;

/**
 * Разворачивает вложенные параметры в плоские пары формата Moodle:
 * `{ ids: [5, 6], data: { a: { text: 'x' } } }` →
 * `ids[0]=5`, `ids[1]=6`, `data[a][text]=x`.
 * `undefined`/`null` пропускаются: «не задано» у Moodle — отсутствие ключа.
 */
export function encodeParams(params: MoodleParams): [string, string][] {
  const out: [string, string][] = [];
  const walk = (prefix: string, value: MoodleParamValue): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(`${prefix}[${i}]`, item));
    } else if (typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) walk(`${prefix}[${key}]`, item);
    } else if (typeof value === 'boolean') {
      out.push([prefix, value ? '1' : '0']);
    } else {
      out.push([prefix, String(value)]);
    }
  };
  for (const [key, value] of Object.entries(params)) walk(key, value);
  return out;
}

export interface CallOptions {
  signal?: AbortSignal | undefined;
  /** Вызов меняет данные: не ретраить. */
  mutation?: boolean;
}

interface MoodleException {
  exception: string;
  errorcode?: string;
  message?: string;
  debuginfo?: string;
}

function isMoodleException(body: unknown): body is MoodleException {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as MoodleException).exception === 'string'
  );
}

const RETRIABLE_HTTP_CODES = new Set([429, 500, 502, 503, 504]);
const BACKOFF_BASE_MS = 300;

/**
 * Таймаут одной попытки скачивания. Отдельно от MOODLE_TIMEOUT: тот рассчитан
 * на JSON-ответы, а архив сдачи в десятки мегабайт законно качается дольше.
 */
export const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

function isRetriable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError') return false;
  if (err.name === 'TimeoutError') return true;
  return /fetch failed|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(err.message);
}

function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const defined = signals.filter((s): s is AbortSignal => s !== undefined);
  return defined.length === 1 ? defined[0]! : AbortSignal.any(defined);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export class MoodleClient {
  readonly siteUrl: string;
  private readonly getToken: () => Promise<string>;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(config: MoodleClientConfig) {
    this.siteUrl = config.siteUrl.replace(/\/+$/, '');
    this.getToken = config.getToken;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.retries = config.retries ?? 2;
  }

  /** Вызывает функцию веб-сервиса и возвращает разобранный JSON. */
  async call<T>(wsfunction: string, params: MoodleParams = {}, options?: CallOptions): Promise<T> {
    const token = await this.loadToken(wsfunction);
    const body = new URLSearchParams([
      ['wstoken', token],
      ['wsfunction', wsfunction],
      ['moodlewsrestformat', 'json'],
      ...encodeParams(params),
    ]);
    const url = `${this.siteUrl}/webservice/rest/server.php`;
    log('info', `call ${wsfunction}`);

    const maxAttempts = options?.mutation ? 1 : this.retries + 1;
    let response: Response | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const last = attempt === maxAttempts - 1;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body,
          signal: combineSignals(AbortSignal.timeout(this.timeoutMs), options?.signal),
        });
        if (response.ok || !RETRIABLE_HTTP_CODES.has(response.status) || last) break;
        void response.body?.cancel().catch(() => {});
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw err;
        if (!isRetriable(err) || last) {
          throw new MoodleRequestError('network', wsfunction, this.describe(err, token), {
            cause: err,
          });
        }
      }
      log('warning', `Retry ${attempt + 1}/${maxAttempts - 1} for ${wsfunction}`);
      await sleep(BACKOFF_BASE_MS * 2 ** attempt, options?.signal);
    }
    if (!response) {
      throw new MoodleRequestError('network', wsfunction, 'запрос не дал ответа');
    }

    const text = await response.text().catch(() => '');
    if (!response.ok) {
      throw new MoodleRequestError(
        'http',
        wsfunction,
        `HTTP ${response.status}: ${scrub(text.slice(0, 500), token)}`,
        { statusCode: response.status },
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new MoodleRequestError(
        'parse',
        wsfunction,
        `ответ не JSON: ${scrub(text.slice(0, 200), token)}`,
        { statusCode: response.status },
      );
    }

    if (isMoodleException(json)) throw this.toError(wsfunction, json, token);
    return json as T;
  }

  /**
   * Приводит ссылку на файл к форме, по которой его отдаёт веб-сервис:
   * тот же сайт, `/webservice/pluginfile.php/…`, без токена. Ссылка из
   * интерфейса (`/pluginfile.php/…`) переписывается — по ней без cookie
   * сессии файл не отдают.
   */
  normalizeFileUrl(fileUrl: string): URL {
    let url: URL;
    try {
      url = new URL(fileUrl);
    } catch {
      throw new Error('fileUrl — не абсолютный URL.');
    }
    const site = new URL(this.siteUrl);
    if (url.origin !== site.origin) {
      throw new Error(`fileUrl ведёт не на ${site.origin} — качаю только файлы этого сайта.`);
    }
    const sitePath = site.pathname.replace(/\/+$/, '');
    const rel = url.pathname.slice(sitePath.length);
    if (!url.pathname.startsWith(sitePath)) {
      throw new Error('fileUrl вне пути сайта Moodle.');
    }
    if (rel.startsWith('/pluginfile.php/')) {
      url.pathname = `${sitePath}/webservice${rel}`;
    } else if (!rel.startsWith('/webservice/pluginfile.php/')) {
      throw new Error('fileUrl — не ссылка на файл Moodle (ожидался …/pluginfile.php/…).');
    }
    url.searchParams.delete('token');
    url.searchParams.delete('wstoken');
    return url;
  }

  /**
   * Открывает поток файла веб-сервиса. Ответ проверен: 2xx и не JSON-ошибка
   * Moodle (её отдают вместо файла, например при чужом токене).
   */
  async openFile(
    fileUrl: string,
    options?: CallOptions,
  ): Promise<{ url: URL; response: Response }> {
    const what = 'pluginfile';
    const url = this.normalizeFileUrl(fileUrl);
    const token = await this.loadToken(what);
    const withToken = new URL(url);
    withToken.searchParams.set('token', token);
    log('info', `download ${url.pathname}`);

    let response: Response;
    try {
      response = await fetch(withToken, {
        signal: combineSignals(AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), options?.signal),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      throw new MoodleRequestError('network', what, this.describe(err, token), { cause: err });
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok || contentType.includes('application/json')) {
      const text = await response.text().catch(() => '');
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      if (isMoodleException(json)) throw this.toError(what, json, token);
      if (response.ok) return { url, response: new Response(text, response) };
      throw new MoodleRequestError(
        'http',
        what,
        `HTTP ${response.status}: ${scrub(text.slice(0, 300), token)}`,
        { statusCode: response.status },
      );
    }
    return { url, response };
  }

  private async loadToken(wsfunction: string): Promise<string> {
    try {
      return await this.getToken();
    } catch (err) {
      throw new MoodleRequestError(
        'auth',
        wsfunction,
        err instanceof Error ? err.message : String(err),
        { cause: err },
      );
    }
  }

  private describe(err: unknown, token: string): string {
    return scrub(err instanceof Error ? err.message : String(err), token);
  }

  private toError(wsfunction: string, body: MoodleException, token: string): MoodleRequestError {
    const errorcode = body.errorcode;
    const message = scrub(body.message ?? body.exception, token);
    if (errorcode && AUTH_ERROR_CODES.has(errorcode)) {
      return new MoodleRequestError('auth', wsfunction, `${message} ${LOGIN_HINT}`, { errorcode });
    }
    return new MoodleRequestError(
      'moodle',
      wsfunction,
      `${message} [${errorcode ?? body.exception}]`,
      {
        errorcode,
      },
    );
  }
}

let clientInstance: MoodleClient | null = null;
const clientStorage = new AsyncLocalStorage<MoodleClient>();

export function createMoodleClientFromConfig(): MoodleClient {
  const cfg = getConfig();
  return new MoodleClient({
    siteUrl: cfg.MOODLE_URL,
    getToken,
    timeoutMs: cfg.MOODLE_TIMEOUT,
  });
}

/**
 * Клиент текущего контекста: ALS (per-server, `runWithClient` в server.ts) →
 * ленивый singleton для прямых вызовов `execute()` (смок-скрипт).
 */
export function getMoodleClient(): MoodleClient {
  const fromAls = clientStorage.getStore();
  if (fromAls) return fromAls;
  clientInstance ??= createMoodleClientFromConfig();
  return clientInstance;
}

export function runWithClient<T>(client: MoodleClient, fn: () => Promise<T>): Promise<T> {
  return clientStorage.run(client, fn);
}
