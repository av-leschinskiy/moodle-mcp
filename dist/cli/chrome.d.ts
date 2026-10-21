/**
 * Chrome для `moodle-mcp-login`: поиск бинаря, запуск с отдельным профилем и
 * перехват редиректа `moodlemobile://` через Chrome DevTools Protocol.
 *
 * Почему браузер, а не форма логина из кода: вход на сайт может идти через
 * внешнего OAuth-провайдера с капчей, и проходит его человек. Код только
 * открывает окно и ждёт, когда Moodle отдаст токен, — ввод не автоматизируется.
 *
 * Отдельный профиль (`CHROME_PROFILE_DIR`) сохраняет cookies между логинами:
 * повторный вход часто проходит без ввода пароля. С основным профилем
 * пользователя CDP не работает (Chrome запрещает remote debugging на нём).
 */
import { type ChildProcess } from 'node:child_process';
/** Имена, под которыми Chrome/Chromium ищется в PATH, в порядке предпочтения. */
export declare const CHROME_CANDIDATES: readonly ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser'];
export declare const CHROME_PROFILE_DIR: string;
/** Бинарь Chrome: явный (MOODLE_CHROME) либо первый из CHROME_CANDIDATES в PATH. */
export declare function findChrome(explicit: string | undefined, pathEnv?: string, canExecute?: (path: string) => boolean): string;
/**
 * Разбор `DevToolsActivePort`: первая строка — порт, вторая — путь
 * WebSocket браузера. Chrome пишет файл, когда `--remote-debugging-port=0`
 * выбрал свободный порт.
 */
export declare function parseDevToolsActivePort(text: string): {
    port: number;
    browserPath: string;
};
export declare function launchChrome(binary: string, profileDir: string): ChildProcess;
/** Ждёт, пока Chrome напишет DevToolsActivePort в профиль. */
export declare function waitForDevToolsPort(profileDir: string, chrome: ChildProcess, timeoutMs: number): Promise<{
    port: number;
    browserPath: string;
}>;
interface CdpMessage {
    id?: number;
    method?: string;
    sessionId?: string;
    params?: Record<string, unknown>;
    result?: Record<string, unknown>;
    error?: {
        message: string;
    };
}
/**
 * URL-ы из событий CDP, в которых может оказаться редирект с токеном. Три
 * источника, потому что Chrome показывает переход на внешнюю схему
 * по-разному в зависимости от того, как Moodle его делает (302 или JS).
 */
export declare function urlsFromCdpEvent(msg: CdpMessage): string[];
/**
 * Подключается к браузеру по CDP, открывает `startUrl` в первой вкладке и
 * ждёт навигации на `moodlemobile://…` в любой вкладке (вход мог открыть
 * всплывающее окно). Возвращает URL редиректа.
 */
export declare function captureLaunchRedirect(opts: {
    wsUrl: string;
    startUrl: string;
    timeoutMs: number;
    chrome: ChildProcess;
}): Promise<{
    redirect: string;
    closeBrowser: () => Promise<void>;
}>;
export {};
//# sourceMappingURL=chrome.d.ts.map