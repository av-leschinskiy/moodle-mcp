#!/usr/bin/env node
// Прокси к нативному (Go) компилятору TypeScript 7.
//
// Зачем не `npx tsc`: typescript-eslint до TS 7.1 требует JS-API компилятора,
// которого в TS 7.0 нет. Поэтому пакеты разведены по официальной схеме
// side-by-side (см. AGENTS.md → TypeScript):
//   typescript          → npm:@typescript/typescript6  (API для линтера, bin tsc6)
//   @typescript/native  → npm:typescript@7             (компилятор, bin tsc)
// Внутри `@typescript/typescript6` лежит настоящий TS 6, и ЕГО bin `tsc`
// выигрывает гонку за `node_modules/.bin/tsc`. Поэтому зовём бинарь по пути,
// а не по имени: иначе сборка молча уедет на шестёрку.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

let tscPath;
try {
  tscPath = join(dirname(require.resolve('@typescript/native/package.json')), 'bin', 'tsc');
} catch {
  console.error(
    'Не найден пакет @typescript/native (это TypeScript 7 под алиасом). Выполните: npm install',
  );
  process.exit(1);
}

const child = spawn(process.execPath, [tscPath, ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
