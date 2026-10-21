/**
 * Единая точка конфигурации MCP-сервера.
 *
 * Все env-vars читаются здесь один раз на старте. Это даёт:
 *   1. Один stub для тестов вместо моков process.env в каждом модуле
 *   2. Документированный список переменных в одном месте
 *   3. Раннюю валидацию (плохой MOODLE_TIMEOUT → понятная ошибка, не NaN в fetch)
 */
import { z } from 'zod';
/**
 * Тот же разбор флага, но БЕЗ обращения к разобранному конфигу.
 *
 * Нужен обработчику ошибки старта в `index.ts`: конфиг там мог не пройти
 * валидацию, и `isDebug()` бросил бы повторно внутри catch.
 */
export declare function isDebugRequested(rawValue?: string | undefined): boolean;
/**
 * Каноническая форма адреса сайта: без завершающих слэшей.
 *
 * Moodle подписывает ответ launch.php как md5(wwwroot + passport), а wwwroot
 * хранится без слэша на конце. Адрес из env и адрес в файле токена сравниваются
 * тоже в этой форме — иначе `https://x/` и `https://x` считались бы разными
 * сайтами и требовали перелогина.
 */
export declare function normalizeSiteUrl(url: string): string;
/** Каталог с файлом токена и профилем Chrome для логина. */
export declare const CONFIG_DIR: string;
/**
 * Схема окружения. `.describe()` каждого поля — источник таблиц «Конфигурация»
 * в README.md и «Environment» в AGENTS.md: их генерирует `scripts/env-docs.mjs`
 * (`npm run docs:env`), руками таблицы не править. Поэтому описание — одна
 * строка в терминах пользователя; всё, что длиннее, идёт в JSDoc рядом.
 */
export declare const envSchema: z.ZodObject<{
    MOODLE_URL: z.ZodEffects<z.ZodString, string, string>;
    /**
     * Формат `{"site","token","privatetoken"}`, права 0600. Пишет его
     * `moodle-mcp-login`, читает сервер на каждый запрос — перелогин
     * подхватывается без перезапуска хоста.
     */
    MOODLE_TOKEN_FILE: z.ZodDefault<z.ZodString>;
    /**
     * Если задан — используется как есть, файл токена не читается и проверка
     * сайта не делается: это ручной режим для CI и смок-прогонов.
     */
    MOODLE_TOKEN: z.ZodOptional<z.ZodString>;
    MOODLE_TIMEOUT: z.ZodDefault<z.ZodNumber>;
    /**
     * Нужен только `moodle-mcp-login`. Без него ищутся по PATH
     * `CHROME_CANDIDATES` из `src/cli/chrome.ts`.
     */
    MOODLE_CHROME: z.ZodOptional<z.ZodString>;
    /**
     * Влияет на два канала: порог stderr-вывода и уровень `debug` в
     * notifications хоста (см. `src/utils/logger.ts`).
     */
    MOODLE_DEBUG: z.ZodDefault<z.ZodEffects<z.ZodBoolean, boolean, unknown>>;
}, "strip", z.ZodTypeAny, {
    MOODLE_URL: string;
    MOODLE_TOKEN_FILE: string;
    MOODLE_TOKEN?: string | undefined;
    MOODLE_TIMEOUT: number;
    MOODLE_CHROME?: string | undefined;
    MOODLE_DEBUG: boolean;
}, {
    MOODLE_URL: string;
    MOODLE_TOKEN_FILE?: string | undefined;
    MOODLE_TOKEN?: string | undefined;
    MOODLE_TIMEOUT?: number | undefined;
    MOODLE_CHROME?: string | undefined;
    MOODLE_DEBUG?: unknown;
}>;
export type Config = z.infer<typeof envSchema>;
/**
 * Чем заменить фактический default в документации, когда он зависит от машины
 * (`homedir()` подставил бы путь того, кто запустил генератор).
 */
export declare const ENV_DISPLAY_DEFAULTS: Partial<Record<keyof Config, string>>;
export declare function getConfig(): Config;
export declare function isDebug(): boolean;
/** Сброс кэша (только для тестов). */
export declare function resetConfig(): void;
//# sourceMappingURL=config.d.ts.map