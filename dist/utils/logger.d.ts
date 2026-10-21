/**
 * Логгер MCP-сервера. Все локальные логи идут в stderr — stdout зарезервирован
 * под протокол MCP (JSON-RPC). Любой console.log в stdout сломал бы транспорт.
 *
 * Дополнительно: если задекларирована capability `logging: {}` и установлен
 * server через `setLogServer`, события дублируются в хост через
 * `notifications/message` (MCP-протокол). Хост сам фильтрует по уровню.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export type LogLevel = 'debug' | 'info' | 'warning' | 'error';
export declare function setLogServer(server: McpServer): void;
export declare function log(level: LogLevel, ...args: unknown[]): void;
//# sourceMappingURL=logger.d.ts.map