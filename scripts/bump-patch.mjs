#!/usr/bin/env node
/**
 * Инкрементирует package.json#version patch-числом, если есть изменения в src/.
 * Запускается из pre-commit hook.
 *
 * Зачем — НЕ для доставки. Раньше здесь было написано, что без бампа
 * `npx git+ssh://...` не подтягивает свежий код, потому что semver-cache npx
 * считает версию неизменной. Проверено на npm 11.16.0 (2026-07-30) — неверно:
 * для git-спецификации npx каждый раз резолвит HEAD у remote и переустанавливает
 * пакет при расхождении, а кэш `~/.npm/_npx/<хэш URL>` переиспользуется только
 * когда HEAD тот же. Эксперимент: коммит БЕЗ бампа версии подтянулся так же,
 * как коммит с бампом.
 *
 * Реальная польза бампа — наблюдаемость: `moodle_site_info` показывает разные
 * версии, и по багрепорту видно, обновился ли пользователь. Это же
 * единственная точная метка выпуска, потому что BASE_COMMIT из
 * stamp-version.mjs указывает на родительский коммит (см. комментарий там).
 *
 * Идемпотентность: если в стейдже нет файлов под src/ — выходит молча.
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const pkgPath = resolve(repoRoot, 'package.json');

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: repoRoot, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

// Проверяем, есть ли в стейдже изменения src/ (то есть функциональные).
// Чистые правки docs/dist/tests не bump-ят версию.
const staged = git('diff --cached --name-only');
const stagedLines = staged.split('\n').filter(Boolean);

// Если package.json уже в стейдже — пользователь сам редактирует версию
// (например, для minor/major-bump). Не перезаписываем его выбор.
if (stagedLines.includes('package.json')) {
  console.error('bump-patch: package.json уже в стейдже — оставляю ручную версию');
  process.exit(0);
}

const hasSrcChanges = stagedLines.some(
  (f) => f.startsWith('src/') && !f.endsWith('.test.ts') && f !== 'src/version.ts',
);

if (!hasSrcChanges) {
  process.exit(0);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
const newVersion = `${major}.${minor}.${patch + 1}`;
pkg.version = newVersion;

// 2 пробела + перевод строки в конце — соответствует prettier-стилю
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.error(`bump-patch: ${major}.${minor}.${patch} → ${newVersion} (src/ changes detected)`);
