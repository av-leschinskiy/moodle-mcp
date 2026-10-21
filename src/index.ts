#!/usr/bin/env node
/**
 * Moodle MCP Server — Entry Point
 */

// ПЕРВЫМ импортом и только side-effect'ом: перехват console.log должен
// встать до загрузки остального графа модулей (SDK и транзитивные
// зависимости печатают на этапе инициализации, а stdout занят JSON-RPC).
import './stdout-guard.js';

import { isDebugRequested } from './config.js';
import { runServer } from './server.js';
import { log } from './utils/logger.js';

// 1 — init error: невалидный конфиг, не смогли подключить transport.
// 2 — runtime crash: uncaught exception / unhandled rejection.
const EXIT_INIT_ERROR = 1;
const EXIT_RUNTIME_ERROR = 2;

process.on('uncaughtException', (error) => {
  log('error', 'Uncaught exception:', error);
  process.exit(EXIT_RUNTIME_ERROR);
});

process.on('unhandledRejection', (reason) => {
  log('error', 'Unhandled promise rejection:', reason);
  process.exit(EXIT_RUNTIME_ERROR);
});

runServer().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  log('error', `Failed to start Moodle MCP server: ${message}`);

  // Стек прячем за MOODLE_DEBUG: типичная ошибка старта — невалидный env, и
  // пользователю нужен её текст, а не трейс. Разбор флага берём из config.ts
  // (`isDebugRequested` не трогает разобранный конфиг): конфиг мог не пройти
  // валидацию, и `isDebug()` бросил бы повторно уже внутри этого обработчика.
  if (isDebugRequested() && error instanceof Error && error.stack) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.exit(EXIT_INIT_ERROR);
});
