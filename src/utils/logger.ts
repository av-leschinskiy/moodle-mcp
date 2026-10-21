/**
 * Логгер MCP-сервера. Все локальные логи идут в stderr — stdout зарезервирован
 * под протокол MCP (JSON-RPC). Любой console.log в stdout сломал бы транспорт.
 *
 * Дополнительно: если задекларирована capability `logging: {}` и установлен
 * server через `setLogServer`, события дублируются в хост через
 * `notifications/message` (MCP-протокол). Хост сам фильтрует по уровню.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isDebug } from '../config.js';
import { PACKAGE_NAME } from '../version.js';

export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

let mcpServer: McpServer | undefined;

export function setLogServer(server: McpServer): void {
  mcpServer = server;
}

export function log(level: LogLevel, ...args: unknown[]): void {
  // Два независимых канала с разными порогами.
  //
  // Хост: уровень выбирает он сам через `logging/setLevel` — SDK отбрасывает
  // лишнее в sendLoggingMessage. Раньше `info` глушился здесь ещё до отправки,
  // и хост не видел его, даже когда явно просил. Придерживаем только `debug`:
  // это наш внутренний шум (по строке на HTTP-запрос), а не сигнал хосту.
  if (mcpServer && (level !== 'debug' || isDebug())) {
    void mcpServer
      .sendLoggingMessage({
        level,
        logger: PACKAGE_NAME,
        data: args.length === 1 ? args[0] : args,
      })
      .catch(() => {
        // Транспорт ещё не connected или закрылся — stderr-копия уже ушла.
      });
  }

  // stderr: порог по MOODLE_DEBUG, чтобы обычный запуск не сорил в терминал.
  if ((level === 'info' || level === 'debug') && !isDebug()) return;
  console.error(`[${PACKAGE_NAME}][${level}]`, ...args);
}
