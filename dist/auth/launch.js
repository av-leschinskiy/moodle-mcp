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
import { createHash, randomBytes } from 'node:crypto';
/** Сервис веб-API, который открывает мобильное приложение Moodle. */
export const MOBILE_SERVICE = 'moodle_mobile_app';
/** Схема редиректа. Браузер её не обработает — мы перехватим навигацию. */
export const URL_SCHEME = 'moodlemobile';
export function newPassport() {
    return randomBytes(16).toString('hex');
}
export function buildLaunchUrl(site, passport) {
    const url = new URL(`${site}/admin/tool/mobile/launch.php`);
    url.searchParams.set('service', MOBILE_SERVICE);
    url.searchParams.set('passport', passport);
    url.searchParams.set('urlscheme', URL_SCHEME);
    return url.toString();
}
export function launchSignature(site, passport) {
    return createHash('md5')
        .update(site + passport)
        .digest('hex');
}
/** Похоже ли это на редирект с токеном — для фильтра событий браузера. */
export function isLaunchRedirect(url) {
    return url.startsWith(`${URL_SCHEME}://`);
}
/**
 * Разбирает `moodlemobile://token=<base64>` и проверяет подпись.
 *
 * Ошибки не цитируют вход: в нём токен.
 */
export function parseLaunchRedirect(url, site, passport) {
    const prefix = `${URL_SCHEME}://token=`;
    if (!url.startsWith(prefix)) {
        throw new Error('Редирект Moodle не содержит токена.');
    }
    let payload = url.slice(prefix.length);
    // Браузер мог процентно-закодировать `=` паддинга base64.
    try {
        payload = decodeURIComponent(payload);
    }
    catch {
        // Невалидная %-последовательность — оставляем как есть, base64 скажет сам.
    }
    const parts = Buffer.from(payload, 'base64').toString('utf8').split(':::');
    const [signature, token, privatetoken] = parts;
    if (!signature || !token) {
        throw new Error('Ответ Moodle не разобран: ожидалось signature:::token[:::privatetoken].');
    }
    if (signature !== launchSignature(site, passport)) {
        throw new Error(`Подпись ответа Moodle не совпала. Проверьте, что MOODLE_URL (${site}) ` +
            'в точности равен адресу сайта, включая http/https и путь.');
    }
    return privatetoken ? { token, privatetoken } : { token };
}
//# sourceMappingURL=launch.js.map