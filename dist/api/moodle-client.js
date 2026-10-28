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
import { getToken, LOGIN_HINT } from '../auth/token-store.js';
import { getConfig } from '../config.js';
import { log } from '../utils/logger.js';
export class MoodleRequestError extends Error {
    kind;
    wsfunction;
    errorcode;
    statusCode;
    // Поля объявлены явно: tsconfig держит `erasableSyntaxOnly`.
    constructor(kind, wsfunction, message, extra) {
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
/**
 * Вычищает токены из строки: параметры `token`/`wstoken`/`privatetoken` в URL
 * и формах, а
 * также конкретное значение токена, если оно известно, — на случай, если
 * Moodle процитирует его в тексте ошибки.
 */
export function scrub(text, token) {
    let out = text.replace(/((?:^|[^a-z0-9_])(?:ws|private)?token=)[^&\s"'<>\\]+/gi, '$1***');
    if (token && token.length >= 8)
        out = out.split(token).join('***');
    return out;
}
/**
 * Разворачивает вложенные параметры в плоские пары формата Moodle:
 * `{ ids: [5, 6], data: { a: { text: 'x' } } }` →
 * `ids[0]=5`, `ids[1]=6`, `data[a][text]=x`.
 * `undefined`/`null` пропускаются: «не задано» у Moodle — отсутствие ключа.
 */
export function encodeParams(params) {
    const out = [];
    const walk = (prefix, value) => {
        if (value === undefined || value === null)
            return;
        if (Array.isArray(value)) {
            value.forEach((item, i) => walk(`${prefix}[${i}]`, item));
        }
        else if (typeof value === 'object') {
            for (const [key, item] of Object.entries(value))
                walk(`${prefix}[${key}]`, item);
        }
        else if (typeof value === 'boolean') {
            out.push([prefix, value ? '1' : '0']);
        }
        else {
            out.push([prefix, String(value)]);
        }
    };
    for (const [key, value] of Object.entries(params))
        walk(key, value);
    return out;
}
function isMoodleException(body) {
    return (typeof body === 'object' &&
        body !== null &&
        typeof body.exception === 'string');
}
const RETRIABLE_HTTP_CODES = new Set([429, 500, 502, 503, 504]);
const BACKOFF_BASE_MS = 300;
/**
 * Таймаут одной попытки скачивания. Отдельно от MOODLE_TIMEOUT: тот рассчитан
 * на JSON-ответы, а архив сдачи в десятки мегабайт законно качается дольше.
 */
export const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
function isRetriable(err) {
    if (!(err instanceof Error))
        return false;
    if (err.name === 'AbortError')
        return false;
    if (err.name === 'TimeoutError')
        return true;
    return /fetch failed|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN/i.test(err.message);
}
function combineSignals(...signals) {
    const defined = signals.filter((s) => s !== undefined);
    return defined.length === 1 ? defined[0] : AbortSignal.any(defined);
}
function sleep(ms, signal) {
    if (signal?.aborted)
        return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
export class MoodleClient {
    siteUrl;
    getToken;
    timeoutMs;
    retries;
    constructor(config) {
        this.siteUrl = config.siteUrl.replace(/\/+$/, '');
        this.getToken = config.getToken;
        this.timeoutMs = config.timeoutMs ?? 30_000;
        this.retries = config.retries ?? 2;
    }
    /** Вызывает функцию веб-сервиса и возвращает разобранный JSON. */
    async call(wsfunction, params = {}, options) {
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
        let response;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const last = attempt === maxAttempts - 1;
            try {
                response = await fetch(url, {
                    method: 'POST',
                    headers: { Accept: 'application/json' },
                    body,
                    signal: combineSignals(AbortSignal.timeout(this.timeoutMs), options?.signal),
                });
                if (response.ok || !RETRIABLE_HTTP_CODES.has(response.status) || last)
                    break;
                void response.body?.cancel().catch(() => { });
            }
            catch (err) {
                if (err instanceof Error && err.name === 'AbortError')
                    throw err;
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
            throw new MoodleRequestError('network', wsfunction, 'request returned no response');
        }
        const text = await response.text().catch(() => '');
        if (!response.ok) {
            throw new MoodleRequestError('http', wsfunction, `HTTP ${response.status}: ${scrub(text.slice(0, 500), token)}`, { statusCode: response.status });
        }
        let json;
        try {
            json = JSON.parse(text);
        }
        catch {
            throw new MoodleRequestError('parse', wsfunction, `response is not JSON: ${scrub(text.slice(0, 200), token)}`, { statusCode: response.status });
        }
        if (isMoodleException(json))
            throw this.toError(wsfunction, json, token);
        return json;
    }
    /**
     * Приводит ссылку на файл к форме, по которой его отдаёт веб-сервис:
     * тот же сайт, `/webservice/pluginfile.php/…`, без токена. Ссылка из
     * интерфейса (`/pluginfile.php/…`) переписывается — по ней без cookie
     * сессии файл не отдают.
     */
    normalizeFileUrl(fileUrl) {
        let url;
        try {
            url = new URL(fileUrl);
        }
        catch {
            throw new Error('fileUrl is not an absolute URL.');
        }
        const site = new URL(this.siteUrl);
        if (url.origin !== site.origin) {
            throw new Error(`fileUrl does not point to ${site.origin}; only files from this site can be downloaded.`);
        }
        const sitePath = site.pathname.replace(/\/+$/, '');
        const rel = url.pathname.slice(sitePath.length);
        if (!url.pathname.startsWith(sitePath)) {
            throw new Error('fileUrl is outside the Moodle site path.');
        }
        if (rel.startsWith('/pluginfile.php/')) {
            url.pathname = `${sitePath}/webservice${rel}`;
        }
        else if (!rel.startsWith('/webservice/pluginfile.php/')) {
            throw new Error('fileUrl is not a Moodle file URL (expected …/pluginfile.php/…).');
        }
        url.searchParams.delete('token');
        url.searchParams.delete('wstoken');
        return url;
    }
    /**
     * Открывает поток файла веб-сервиса. Ответ проверен: 2xx и не JSON-ошибка
     * Moodle (её отдают вместо файла, например при чужом токене).
     */
    async openFile(fileUrl, options) {
        const what = 'pluginfile';
        const url = this.normalizeFileUrl(fileUrl);
        const token = await this.loadToken(what);
        const withToken = new URL(url);
        withToken.searchParams.set('token', token);
        log('info', `download ${url.pathname}`);
        let response;
        try {
            response = await fetch(withToken, {
                signal: combineSignals(AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), options?.signal),
            });
        }
        catch (err) {
            if (err instanceof Error && err.name === 'AbortError')
                throw err;
            throw new MoodleRequestError('network', what, this.describe(err, token), { cause: err });
        }
        const contentType = response.headers.get('content-type') ?? '';
        if (!response.ok || contentType.includes('application/json')) {
            const text = await response.text().catch(() => '');
            let json;
            try {
                json = JSON.parse(text);
            }
            catch {
                json = undefined;
            }
            if (isMoodleException(json))
                throw this.toError(what, json, token);
            if (response.ok)
                return { url, response: new Response(text, response) };
            throw new MoodleRequestError('http', what, `HTTP ${response.status}: ${scrub(text.slice(0, 300), token)}`, { statusCode: response.status });
        }
        return { url, response };
    }
    /**
     * Кладёт файл в черновую область пользователя токена
     * (`webservice/upload.php`) и возвращает itemid черновика и имя, под которым
     * Moodle сохранил файл. `itemid` 0 — новый черновик, иначе файл добавляется
     * в уже созданный. Студент черновик не видит; к отзыву его привязывает
     * последующая запись формы оценки.
     *
     * Токен уходит полем тела, не в URL. Повтора нет: второй раз тот же файл
     * в тот же черновик Moodle не примет (`filenameexist`).
     */
    async uploadDraftFile(file, itemid, options) {
        const what = 'upload';
        const token = await this.loadToken(what);
        const form = new FormData();
        form.set('token', token);
        form.set('filearea', 'draft');
        form.set('itemid', String(itemid));
        form.set('filepath', '/');
        form.set('file_1', new Blob([file.data], { type: file.mimeType }), file.name);
        log('info', `upload draft file (${file.data.byteLength} bytes)`);
        let response;
        try {
            response = await fetch(`${this.siteUrl}/webservice/upload.php`, {
                method: 'POST',
                headers: { Accept: 'application/json' },
                body: form,
                signal: combineSignals(AbortSignal.timeout(this.timeoutMs), options?.signal),
            });
        }
        catch (err) {
            if (err instanceof Error && err.name === 'AbortError')
                throw err;
            throw new MoodleRequestError('network', what, this.describe(err, token), { cause: err });
        }
        const text = await response.text().catch(() => '');
        let json;
        try {
            json = JSON.parse(text);
        }
        catch {
            const status = response.ok ? '' : `HTTP ${response.status}: `;
            throw new MoodleRequestError(response.ok ? 'parse' : 'http', what, `${status}response is not JSON: ${scrub(text.slice(0, 200), token)}`, { statusCode: response.status });
        }
        // Исключение upload.php приходит как у AJAX-скрипта: `{error, errorcode}`,
        // а не `{exception, …}`, как у server.php.
        if (!Array.isArray(json)) {
            const body = (json ?? {});
            const errorcode = body.errorcode;
            const message = scrub(body.error ?? body.exception ?? 'unexpected response', token);
            // accessexception здесь — чаще всего выключенная загрузка файлов у
            // сервиса токена: перелогин её не лечит, подсказку про вход не даём.
            if (errorcode && errorcode !== 'accessexception' && AUTH_ERROR_CODES.has(errorcode)) {
                throw new MoodleRequestError('auth', what, `${message} ${LOGIN_HINT}`, { errorcode });
            }
            throw new MoodleRequestError('moodle', what, `${message} [${errorcode ?? 'error'}]`, {
                errorcode,
                statusCode: response.status,
            });
        }
        // Отказ по одному файлу (размер, имя занято) — элемент массива с errortype.
        const entry = json[0];
        if (!entry || entry.errortype || typeof entry.itemid !== 'number' || !entry.filename) {
            throw new MoodleRequestError('moodle', what, `${scrub(entry?.error ?? 'Moodle stored no file', token)} [${entry?.errortype ?? 'error'}]`, { errorcode: entry?.errortype });
        }
        return { itemid: entry.itemid, filename: entry.filename };
    }
    async loadToken(wsfunction) {
        try {
            return await this.getToken();
        }
        catch (err) {
            throw new MoodleRequestError('auth', wsfunction, err instanceof Error ? err.message : String(err), { cause: err });
        }
    }
    describe(err, token) {
        return scrub(err instanceof Error ? err.message : String(err), token);
    }
    toError(wsfunction, body, token) {
        const errorcode = body.errorcode;
        const message = scrub(body.message ?? body.exception, token);
        if (errorcode && AUTH_ERROR_CODES.has(errorcode)) {
            return new MoodleRequestError('auth', wsfunction, `${message} ${LOGIN_HINT}`, { errorcode });
        }
        return new MoodleRequestError('moodle', wsfunction, `${message} [${errorcode ?? body.exception}]`, {
            errorcode,
        });
    }
}
let clientInstance = null;
const clientStorage = new AsyncLocalStorage();
export function createMoodleClientFromConfig() {
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
export function getMoodleClient() {
    const fromAls = clientStorage.getStore();
    if (fromAls)
        return fromAls;
    clientInstance ??= createMoodleClientFromConfig();
    return clientInstance;
}
export function runWithClient(client, fn) {
    return clientStorage.run(client, fn);
}
//# sourceMappingURL=moodle-client.js.map