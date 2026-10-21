#!/usr/bin/env node
/**
 * `moodle-mcp-login` — получение токена веб-сервиса Moodle через вход в браузере.
 *
 * Что делает:
 *   1. Запускает Chrome с окном и отдельным профилем (`CHROME_PROFILE_DIR`),
 *      порт отладки выбирает сам Chrome (`--remote-debugging-port=0`).
 *   2. Открывает `<site>/admin/tool/mobile/launch.php` с новым passport.
 *   3. Ждёт, пока пользователь войдёт, — капчу и пароль вводит человек.
 *   4. Перехватывает редирект `moodlemobile://token=…`, проверяет подпись.
 *   5. Проверяет токен вызовом API и пишет файл токена (0600).
 *
 * Токен не печатается ни при каком исходе — только «вошёл как <имя> на <сайт>».
 *
 * Логика разнесена по `auth/launch.ts` (протокол) и `cli/chrome.ts` (браузер):
 * `main()` здесь исполняется на импорте, а тестируемые части живут отдельно.
 */
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { WS } from '../api/functions.js';
import { MoodleClient, scrub } from '../api/moodle-client.js';
import { buildLaunchUrl, newPassport, parseLaunchRedirect } from '../auth/launch.js';
import { writeToken } from '../auth/token-store.js';
import { getConfig, normalizeSiteUrl } from '../config.js';
import { captureLaunchRedirect, CHROME_PROFILE_DIR, findChrome, launchChrome, waitForDevToolsPort, } from './chrome.js';
/** Сколько ждать входа пользователя. */
const LOGIN_TIMEOUT_MS = 10 * 60_000;
/** Сколько ждать, пока Chrome откроет порт отладки. */
const CHROME_START_TIMEOUT_MS = 30_000;
function clock(date) {
    return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
async function main() {
    const cfg = getConfig();
    const site = cfg.MOODLE_URL;
    const binary = findChrome(cfg.MOODLE_CHROME);
    await mkdir(CHROME_PROFILE_DIR, { recursive: true, mode: 0o700 });
    // Старый файл от прошлого запуска указал бы на мёртвый порт.
    await rm(join(CHROME_PROFILE_DIR, 'DevToolsActivePort'), { force: true });
    const chrome = launchChrome(binary, CHROME_PROFILE_DIR);
    const spawnError = new Promise((_resolve, reject) => {
        chrome.once('error', (err) => reject(new Error(`Не удалось запустить ${binary}: ${err.message}`)));
    });
    try {
        const { port, browserPath } = await Promise.race([
            waitForDevToolsPort(CHROME_PROFILE_DIR, chrome, CHROME_START_TIMEOUT_MS),
            spawnError,
        ]);
        const passport = newPassport();
        process.stderr.write(`Войдите на ${site} в открывшемся окне Chrome. ` +
            `Жду до ${clock(new Date(Date.now() + LOGIN_TIMEOUT_MS))}.\n`);
        const { redirect, closeBrowser } = await captureLaunchRedirect({
            wsUrl: `ws://127.0.0.1:${port}${browserPath}`,
            startUrl: buildLaunchUrl(site, passport),
            timeoutMs: LOGIN_TIMEOUT_MS,
            chrome,
        });
        await closeBrowser();
        const { token, privatetoken } = parseLaunchRedirect(redirect, site, passport);
        // Токен пишем только проверенным: файл с нерабочим токеном хуже, чем
        // его отсутствие, — сервер выдал бы невнятный invalidtoken.
        const client = new MoodleClient({
            siteUrl: site,
            getToken: async () => token,
            timeoutMs: cfg.MOODLE_TIMEOUT,
        });
        const info = await client.call(WS.siteInfo);
        if (info.siteurl && normalizeSiteUrl(info.siteurl) !== site) {
            process.stderr.write(`Внимание: сайт называет себя ${info.siteurl}, а MOODLE_URL = ${site}.\n`);
        }
        await writeToken(cfg.MOODLE_TOKEN_FILE, {
            site,
            token,
            ...(privatetoken ? { privatetoken } : {}),
        });
        process.stdout.write(`Вошёл как ${info.fullname ?? '(без имени)'} на ${site}\n`);
    }
    finally {
        if (chrome.exitCode === null && chrome.signalCode === null)
            chrome.kill('SIGTERM');
    }
}
main().then(() => process.exit(0), (err) => {
    // scrub — страховка: ни одна ветка выше токен в текст не кладёт.
    const message = scrub(err instanceof Error ? err.message : String(err));
    process.stderr.write(`[moodle-mcp-login] Ошибка: ${message}\n`);
    process.exit(1);
});
//# sourceMappingURL=login.js.map