/**
 * Общий контракт описания MCP-тула.
 *
 * Использовать через `defineTool({ ... })` для каждого тула — это связывает
 * `inputSchema` и тип `args` в `execute` через `z.infer`. Прежний паттерн
 * `satisfies Record<string, ToolDef<z.ZodTypeAny>>` НЕ связывает типы:
 * параметр `S` затирается до `ZodTypeAny`, и `args: any`.
 */

import type { CallOptions } from '../api/moodle-client.js';
import type { z } from 'zod';

export interface ToolAnnotations {
  /** Тул только читает данные, не меняет состояние. Default: false. */
  readOnlyHint?: boolean;
  /** Тул может выполнить destructive update (delete и т. п.). Default: false. */
  destructiveHint?: boolean;
  /** Повторный вызов с теми же аргументами даёт тот же эффект. Default: false. */
  idempotentHint?: boolean;
  /** Тул взаимодействует с внешним миром (сеть, БД, файлы). Default: true. */
  openWorldHint?: boolean;
  /** Человеко-читаемое название для UI. */
  title?: string;
}

/**
 * `R` — тип результата `execute`. Выводится из реализации, поэтому тесты
 * читают поля ответа типизированно, а сервер видит `unknown`.
 */
export interface ToolDef<
  S extends z.ZodTypeAny,
  O extends z.ZodTypeAny = z.ZodTypeAny,
  R = unknown,
> {
  description: string;
  inputSchema: S;
  /**
   * Опциональная схема `structuredContent` ответа. SDK пробрасывает её
   * в `tools/list` (JSON Schema) — хост видит типизированный контракт.
   * Должна быть z.object(...).
   */
  outputSchema?: O;
  annotations?: ToolAnnotations;
  /**
   * Не регистрировать тул в server.registerTool. Используется для эндпоинтов,
   * которые ещё не покрыли или временно сломаны — файл остаётся, переключается
   * одним флагом. Модель не видит disabled-тулы.
   */
  disabled?: boolean;
  execute(args: z.infer<S>, signal?: AbortSignal): Promise<R>;
}

export function defineTool<S extends z.ZodTypeAny, R, O extends z.ZodTypeAny = z.ZodTypeAny>(
  def: ToolDef<S, O, R>,
): ToolDef<S, O, R> {
  return def;
}

/**
 * Опции запроса для тула: сигнал отмены, если хост его дал.
 *
 * Нужен из-за `exactOptionalPropertyTypes` — просто `{ signal }` с
 * `signal: undefined` не проходит по типам, а тернарник копировался в каждый
 * вызов.
 */
export function reqOpts(signal?: AbortSignal): CallOptions | undefined {
  return signal ? { signal } : undefined;
}
