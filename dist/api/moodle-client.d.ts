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
export declare class MoodleRequestError extends Error {
    readonly kind: MoodleErrorKind;
    readonly wsfunction: string;
    readonly errorcode: string | undefined;
    readonly statusCode: number | undefined;
    constructor(kind: MoodleErrorKind, wsfunction: string, message: string, extra?: {
        errorcode?: string | undefined;
        statusCode?: number | undefined;
        cause?: unknown;
    });
}
/**
 * Вычищает токены из строки: параметры `token`/`wstoken`/`privatetoken` в URL
 * и формах, а
 * также конкретное значение токена, если оно известно, — на случай, если
 * Moodle процитирует его в тексте ошибки.
 */
export declare function scrub(text: string, token?: string): string;
/** Скалярное значение параметра Moodle. Булевы уходят как 1/0 — так их ждёт PHP. */
export type MoodleScalar = string | number | boolean;
export type MoodleParams = {
    [key: string]: MoodleParamValue;
};
export type MoodleParamValue = MoodleScalar | null | undefined | MoodleParamValue[] | MoodleParams;
/**
 * Разворачивает вложенные параметры в плоские пары формата Moodle:
 * `{ ids: [5, 6], data: { a: { text: 'x' } } }` →
 * `ids[0]=5`, `ids[1]=6`, `data[a][text]=x`.
 * `undefined`/`null` пропускаются: «не задано» у Moodle — отсутствие ключа.
 */
export declare function encodeParams(params: MoodleParams): [string, string][];
export interface CallOptions {
    signal?: AbortSignal | undefined;
    /** Вызов меняет данные: не ретраить. */
    mutation?: boolean;
}
/**
 * Таймаут одной попытки скачивания. Отдельно от MOODLE_TIMEOUT: тот рассчитан
 * на JSON-ответы, а архив сдачи в десятки мегабайт законно качается дольше.
 */
export declare const DOWNLOAD_TIMEOUT_MS: number;
export declare class MoodleClient {
    readonly siteUrl: string;
    private readonly getToken;
    private readonly timeoutMs;
    private readonly retries;
    constructor(config: MoodleClientConfig);
    /** Вызывает функцию веб-сервиса и возвращает разобранный JSON. */
    call<T>(wsfunction: string, params?: MoodleParams, options?: CallOptions): Promise<T>;
    /**
     * Приводит ссылку на файл к форме, по которой его отдаёт веб-сервис:
     * тот же сайт, `/webservice/pluginfile.php/…`, без токена. Ссылка из
     * интерфейса (`/pluginfile.php/…`) переписывается — по ней без cookie
     * сессии файл не отдают.
     */
    normalizeFileUrl(fileUrl: string): URL;
    /**
     * Открывает поток файла веб-сервиса. Ответ проверен: 2xx и не JSON-ошибка
     * Moodle (её отдают вместо файла, например при чужом токене).
     */
    openFile(fileUrl: string, options?: CallOptions): Promise<{
        url: URL;
        response: Response;
    }>;
    private loadToken;
    private describe;
    private toError;
}
export declare function createMoodleClientFromConfig(): MoodleClient;
/**
 * Клиент текущего контекста: ALS (per-server, `runWithClient` в server.ts) →
 * ленивый singleton для прямых вызовов `execute()` (смок-скрипт).
 */
export declare function getMoodleClient(): MoodleClient;
export declare function runWithClient<T>(client: MoodleClient, fn: () => Promise<T>): Promise<T>;
//# sourceMappingURL=moodle-client.d.ts.map