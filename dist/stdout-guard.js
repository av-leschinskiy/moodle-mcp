/**
 * Перехват `console.log` — stdout зарезервирован под MCP JSON-RPC.
 *
 * Живёт отдельным модулем, чтобы `index.ts` мог подключить его side-effect
 * импортом ПЕРВОЙ строкой: ESM выполняет весь граф импортов до тела модуля,
 * поэтому присваивание внутри `index.ts` не покрывало фазу загрузки — а это
 * ровно тот момент, когда чужая зависимость печатает баннер и ломает транспорт.
 *
 * Восстановить перехваченный `console.log` невозможно (транспорт уже занял
 * stdout), поэтому оригинал не сохраняем.
 */
import { PACKAGE_NAME } from './version.js';
console.log = (...args) => {
    process.stderr.write(`[${PACKAGE_NAME}][stdout-guard] ${args.map(String).join(' ')}\n`);
};
//# sourceMappingURL=stdout-guard.js.map