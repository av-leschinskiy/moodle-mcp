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

import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { CONFIG_DIR } from '../config.js';
import { isLaunchRedirect } from '../auth/launch.js';

/** Имена, под которыми Chrome/Chromium ищется в PATH, в порядке предпочтения. */
export const CHROME_CANDIDATES = [
  'google-chrome-stable',
  'google-chrome',
  'chromium',
  'chromium-browser',
] as const;

export const CHROME_PROFILE_DIR = join(CONFIG_DIR, 'chrome-profile');

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Бинарь Chrome: явный (MOODLE_CHROME) либо первый из CHROME_CANDIDATES в PATH. */
export function findChrome(
  explicit: string | undefined,
  pathEnv = process.env.PATH ?? '',
  canExecute: (path: string) => boolean = isExecutable,
): string {
  if (explicit) return explicit;
  const dirs = pathEnv.split(delimiter).filter(Boolean);
  for (const name of CHROME_CANDIDATES) {
    for (const dir of dirs) {
      const candidate = join(dir, name);
      if (canExecute(candidate)) return candidate;
    }
  }
  throw new Error(
    `Chrome не найден в PATH (искал: ${CHROME_CANDIDATES.join(', ')}). Укажите бинарь в MOODLE_CHROME.`,
  );
}

/**
 * Разбор `DevToolsActivePort`: первая строка — порт, вторая — путь
 * WebSocket браузера. Chrome пишет файл, когда `--remote-debugging-port=0`
 * выбрал свободный порт.
 */
export function parseDevToolsActivePort(text: string): { port: number; browserPath: string } {
  const [portLine, pathLine] = text.split(/\r?\n/);
  const port = Number(portLine);
  if (!Number.isInteger(port) || port <= 0 || !pathLine?.startsWith('/devtools/browser/')) {
    throw new Error('DevToolsActivePort не разобран.');
  }
  return { port, browserPath: pathLine.trim() };
}

export function launchChrome(binary: string, profileDir: string): ChildProcess {
  return spawn(
    binary,
    [
      `--user-data-dir=${profileDir}`,
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
}

/** Ждёт, пока Chrome напишет DevToolsActivePort в профиль. */
export async function waitForDevToolsPort(
  profileDir: string,
  chrome: ChildProcess,
  timeoutMs: number,
): Promise<{ port: number; browserPath: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (chrome.exitCode !== null) {
      throw new Error(`Chrome завершился до старта (код ${chrome.exitCode}).`);
    }
    try {
      return parseDevToolsActivePort(
        await readFile(join(profileDir, 'DevToolsActivePort'), 'utf8'),
      );
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('Chrome не открыл порт отладки вовремя.');
}

interface CdpMessage {
  id?: number;
  method?: string;
  sessionId?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message: string };
}

/**
 * URL-ы из событий CDP, в которых может оказаться редирект с токеном. Три
 * источника, потому что Chrome показывает переход на внешнюю схему
 * по-разному в зависимости от того, как Moodle его делает (302 или JS).
 */
export function urlsFromCdpEvent(msg: CdpMessage): string[] {
  const p = msg.params ?? {};
  switch (msg.method) {
    case 'Network.requestWillBeSent':
      return [String((p.request as { url?: string } | undefined)?.url ?? '')];
    case 'Network.responseReceivedExtraInfo': {
      const headers = (p.headers ?? {}) as Record<string, string>;
      return [headers.location ?? headers.Location ?? ''];
    }
    case 'Page.frameRequestedNavigation':
      return [String(p.url ?? '')];
    case 'Target.targetInfoChanged':
      return [String((p.targetInfo as { url?: string } | undefined)?.url ?? '')];
    default:
      return [];
  }
}

/**
 * Подключается к браузеру по CDP, открывает `startUrl` в первой вкладке и
 * ждёт навигации на `moodlemobile://…` в любой вкладке (вход мог открыть
 * всплывающее окно). Возвращает URL редиректа.
 */
export async function captureLaunchRedirect(opts: {
  wsUrl: string;
  startUrl: string;
  timeoutMs: number;
  chrome: ChildProcess;
}): Promise<{ redirect: string; closeBrowser: () => Promise<void> }> {
  const ws = new WebSocket(opts.wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener(
      'error',
      () => reject(new Error('CDP: не удалось подключиться к Chrome.')),
      {
        once: true,
      },
    );
  });

  let nextId = 0;
  const pending = new Map<number, (msg: CdpMessage) => void>();
  const send = (method: string, params: object = {}, sessionId?: string): Promise<CdpMessage> =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  const closeBrowser = async (): Promise<void> => {
    if (ws.readyState === WebSocket.OPEN) {
      await Promise.race([send('Browser.close'), new Promise((r) => setTimeout(r, 2000))]);
      ws.close();
    }
  };

  const redirect = await new Promise<string>((resolve, reject) => {
    const attached = new Set<string>();
    let navigated = false;

    const timer = setTimeout(() => {
      reject(new Error('Вход не завершён вовремя.'));
    }, opts.timeoutMs);
    const onExit = (): void => {
      clearTimeout(timer);
      reject(new Error('Окно Chrome закрыто до завершения входа.'));
    };
    opts.chrome.once('exit', onExit);
    const done = (url: string): void => {
      clearTimeout(timer);
      opts.chrome.off('exit', onExit);
      resolve(url);
    };

    const attach = async (targetId: string): Promise<void> => {
      if (attached.has(targetId)) return;
      attached.add(targetId);
      const reply = await send('Target.attachToTarget', { targetId, flatten: true });
      const sessionId = reply.result?.sessionId as string | undefined;
      if (!sessionId) return;
      await send('Network.enable', {}, sessionId);
      await send('Page.enable', {}, sessionId);
      if (!navigated) {
        navigated = true;
        await send('Page.navigate', { url: opts.startUrl }, sessionId);
      }
    };

    ws.addEventListener('message', (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as CdpMessage;
      if (msg.id !== undefined) {
        pending.get(msg.id)?.(msg);
        pending.delete(msg.id);
        return;
      }
      const found = urlsFromCdpEvent(msg).find(isLaunchRedirect);
      if (found) {
        done(found);
        return;
      }
      if (msg.method === 'Target.targetCreated' || msg.method === 'Target.targetInfoChanged') {
        const info = msg.params?.targetInfo as { targetId: string; type: string } | undefined;
        if (info?.type === 'page') void attach(info.targetId).catch(() => {});
      }
    });

    void send('Target.setDiscoverTargets', { discover: true });
  });

  return { redirect, closeBrowser };
}
