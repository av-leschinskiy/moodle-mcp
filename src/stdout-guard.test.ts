import { describe, expect, it, vi } from 'vitest';

describe('stdout-guard', () => {
  it('перенаправляет console.log в stderr с пометкой', async () => {
    const original = console.log;
    const written: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });

    try {
      await import('./stdout-guard.js');
      console.log('случайный вывод', 42);

      expect(written.join('')).toContain('[moodle-mcp][stdout-guard] случайный вывод 42');
    } finally {
      spy.mockRestore();
      // Перехват в проде необратим, но тестовому процессу консоль нужна дальше.
      console.log = original;
    }
  });
});
