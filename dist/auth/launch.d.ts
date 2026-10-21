/**
 * Протокол выдачи токена мобильного сервиса Moodle через `launch.php`.
 *
 * Мобильное приложение открывает в браузере
 * `<site>/admin/tool/mobile/launch.php?service=…&passport=…&urlscheme=…`.
 * После входа пользователя Moodle редиректит на
 * `<urlscheme>://token=<base64>`, где base64 раскрывается в
 * `signature:::token:::privatetoken`, а signature = md5(wwwroot + passport).
 * Подпись доказывает, что ответ выдан нашим сайтом на наш passport, а не
 * подсунут чужой страницей.
 *
 * Модуль чистый (без сети и браузера) — его разбор покрыт тестами, а
 * `cli/login.ts` только перехватывает URL и зовёт эти функции.
 */
/** Сервис веб-API, который открывает мобильное приложение Moodle. */
export declare const MOBILE_SERVICE = "moodle_mobile_app";
/** Схема редиректа. Браузер её не обработает — мы перехватим навигацию. */
export declare const URL_SCHEME = "moodlemobile";
export declare function newPassport(): string;
export declare function buildLaunchUrl(site: string, passport: string): string;
export declare function launchSignature(site: string, passport: string): string;
/** Похоже ли это на редирект с токеном — для фильтра событий браузера. */
export declare function isLaunchRedirect(url: string): boolean;
export interface LaunchTokens {
    token: string;
    privatetoken?: string;
}
/**
 * Разбирает `moodlemobile://token=<base64>` и проверяет подпись.
 *
 * Ошибки не цитируют вход: в нём токен.
 */
export declare function parseLaunchRedirect(url: string, site: string, passport: string): LaunchTokens;
//# sourceMappingURL=launch.d.ts.map