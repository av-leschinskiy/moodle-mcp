/**
 * Единая точка конфигурации MCP-сервера.
 *
 * Все env-vars читаются здесь один раз на старте. Это даёт:
 *   1. Один stub для тестов вместо моков process.env в каждом модуле
 *   2. Документированный список переменных в одном месте
 *   3. Раннюю валидацию (плохой MOODLE_TIMEOUT → понятная ошибка, не NaN в fetch)
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
/** Значения, которые в env означают «включено». Всё прочее — выключено. */
const TRUTHY_FLAG = new Set(['1', 'true', 'yes', 'on']);
/**
 * Приводит env-строку к булеву флагу. Ключевое — НЕ падать на незнакомом
 * значении: `MOODLE_DEBUG=false` это попытка выключить отладку, а не ошибка
 * конфигурации, и ронять из-за неё сервер несоразмерно.
 */
function toFlag(value) {
    if (typeof value === 'boolean')
        return value;
    return typeof value === 'string' && TRUTHY_FLAG.has(value.trim().toLowerCase());
}
/**
 * Тот же разбор флага, но БЕЗ обращения к разобранному конфигу.
 *
 * Нужен обработчику ошибки старта в `index.ts`: конфиг там мог не пройти
 * валидацию, и `isDebug()` бросил бы повторно внутри catch.
 */
export function isDebugRequested(rawValue = process.env.MOODLE_DEBUG) {
    return toFlag(rawValue);
}
/**
 * Каноническая форма адреса сайта: без завершающих слэшей.
 *
 * Moodle подписывает ответ launch.php как md5(wwwroot + passport), а wwwroot
 * хранится без слэша на конце. Адрес из env и адрес в файле токена сравниваются
 * тоже в этой форме — иначе `https://x/` и `https://x` считались бы разными
 * сайтами и требовали перелогина.
 */
export function normalizeSiteUrl(url) {
    return url.trim().replace(/\/+$/, '');
}
/** Каталог с файлом токена и профилем Chrome для логина. */
export const CONFIG_DIR = join(homedir(), '.config', 'mcp-moodle');
/**
 * Схема окружения. `.describe()` каждого поля — источник таблиц «Конфигурация»
 * в README.md и «Environment» в AGENTS.md: их генерирует `scripts/env-docs.mjs`
 * (`npm run docs:env`), руками таблицы не править. Поэтому описание — одна
 * строка в терминах пользователя; всё, что длиннее, идёт в JSDoc рядом.
 */
export const envSchema = z.object({
    MOODLE_URL: z
        .string()
        .url()
        .transform(normalizeSiteUrl)
        .describe('Адрес сайта Moodle (wwwroot), например `https://moodle.example.org`'),
    /**
     * Формат `{"site","token","privatetoken"}`, права 0600. Пишет его
     * `moodle-mcp-login`, читает сервер на каждый запрос — перелогин
     * подхватывается без перезапуска хоста.
     */
    MOODLE_TOKEN_FILE: z
        .string()
        .default(join(CONFIG_DIR, 'token.json'))
        .describe('Куда `moodle-mcp-login` сохраняет токен (путь резолвится через `homedir()`)'),
    /**
     * Если задан — используется как есть, файл токена не читается и проверка
     * сайта не делается: это ручной режим для CI и смок-прогонов.
     */
    MOODLE_TOKEN: z.string().optional().describe('Override токена веб-сервиса (CI / смок-тесты)'),
    MOODLE_TIMEOUT: z.coerce
        .number()
        .int()
        .positive()
        .default(30_000)
        .describe('Таймаут одного запроса к API (мс)'),
    /**
     * Нужен только `moodle-mcp-login`. Без него ищутся по PATH
     * `CHROME_CANDIDATES` из `src/cli/chrome.ts`.
     */
    MOODLE_CHROME: z
        .string()
        .optional()
        .describe('Бинарь Chrome/Chromium для `moodle-mcp-login` (по умолчанию ищется в PATH)'),
    /**
     * Влияет на два канала: порог stderr-вывода и уровень `debug` в
     * notifications хоста (см. `src/utils/logger.ts`).
     */
    MOODLE_DEBUG: z
        .preprocess(toFlag, z.boolean())
        .default(false)
        .describe('`1`/`true`/`yes`/`on` — отладочный вывод в stderr и уровень `debug` в канал хоста'),
});
/**
 * Чем заменить фактический default в документации, когда он зависит от машины
 * (`homedir()` подставил бы путь того, кто запустил генератор).
 */
export const ENV_DISPLAY_DEFAULTS = {
    MOODLE_TOKEN_FILE: '~/.config/mcp-moodle/token.json',
};
let cached = null;
/**
 * Снимок окружения для схемы: пустые строки выбрасываются как «не задано».
 *
 * MCP-реестры и обёртки штатно подставляют `""` вместо того, чтобы не задавать
 * переменную вовсе. Без этой нормализации `MOODLE_TIMEOUT=` роняло бы старт
 * вместо применения дефолта.
 */
function envSnapshot() {
    const snapshot = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined && value.trim() !== '')
            snapshot[key] = value;
    }
    return snapshot;
}
export function getConfig() {
    if (cached)
        return cached;
    const parsed = envSchema.safeParse(envSnapshot());
    if (!parsed.success) {
        // Только путь и текст проблемы: значение переменной (а это может быть
        // MOODLE_TOKEN) в сообщение не попадает.
        const issues = parsed.error.issues
            .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
            .join('\n');
        throw new Error(`Некорректная конфигурация окружения:\n${issues}`);
    }
    cached = parsed.data;
    return cached;
}
export function isDebug() {
    return getConfig().MOODLE_DEBUG;
}
/** Сброс кэша (только для тестов). */
export function resetConfig() {
    cached = null;
}
//# sourceMappingURL=config.js.map