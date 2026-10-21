/**
 * Общий контракт описания MCP-тула.
 *
 * Использовать через `defineTool({ ... })` для каждого тула — это связывает
 * `inputSchema` и тип `args` в `execute` через `z.infer`. Прежний паттерн
 * `satisfies Record<string, ToolDef<z.ZodTypeAny>>` НЕ связывает типы:
 * параметр `S` затирается до `ZodTypeAny`, и `args: any`.
 */
export function defineTool(def) {
    return def;
}
/**
 * Опции запроса для тула: сигнал отмены, если хост его дал.
 *
 * Нужен из-за `exactOptionalPropertyTypes` — просто `{ signal }` с
 * `signal: undefined` не проходит по типам, а тернарник копировался в каждый
 * вызов.
 */
export function reqOpts(signal) {
    return signal ? { signal } : undefined;
}
//# sourceMappingURL=types.js.map