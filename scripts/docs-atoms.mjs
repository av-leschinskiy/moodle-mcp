#!/usr/bin/env node
// Проверяет атомы docs/ по нормам docs/conventions/documentation.md:
// атом лежит в известной папке, у него frontmatter с title, description и tags,
// теги — из словаря docs/_tags.json, пути из code: существуют.
//
//   node scripts/docs-atoms.mjs   — exit 1 и список нарушений, если они есть
//
// Зачем: словарь тегов и пути в code: — второе место для фактов, которые живут
// в коде; без проверки они молча расходятся с ним.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = join(repoRoot, 'docs');

// Папки видов атомов; в корне docs/ — только служебные файлы.
const KIND_DIRS = ['conventions', 'features', 'systems', 'runbooks'];
const ROOT_FILES = ['_tags.json', '_template.md'];

const tags = new Set(Object.keys(JSON.parse(readFileSync(join(docsDir, '_tags.json'), 'utf8'))));
const errors = [];

function listMarkdown(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listMarkdown(path);
    return name.endsWith('.md') ? [path] : [];
  });
}

/** Значения frontmatter в одну строку; списки `[a, b]` — массивом. */
function parseFrontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split('\n')) {
    const kv = /^(\w+): (.*)$/.exec(line);
    if (!kv) continue;
    const [, key, raw] = kv;
    const list = /^\[(.*)\]$/.exec(raw);
    fields[key] = list
      ? list[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : raw.trim();
  }
  return fields;
}

for (const name of readdirSync(docsDir)) {
  const path = join(docsDir, name);
  if (statSync(path).isDirectory()) {
    if (!KIND_DIRS.includes(name)) errors.push(`docs/${name}/: папка не из видов атомов`);
  } else if (!ROOT_FILES.includes(name)) {
    errors.push(`docs/${name}: в корне docs/ только ${ROOT_FILES.join(', ')}`);
  }
}

for (const path of listMarkdown(docsDir)) {
  const rel = relative(repoRoot, path);
  const fm = parseFrontmatter(readFileSync(path, 'utf8'));
  if (!fm) {
    errors.push(`${rel}: нет frontmatter`);
    continue;
  }
  for (const key of ['title', 'description', 'tags']) {
    if (!fm[key] || fm[key].length === 0) errors.push(`${rel}: нет поля ${key}`);
  }
  for (const tag of fm.tags ?? []) {
    if (!tags.has(tag)) errors.push(`${rel}: тег «${tag}» не из docs/_tags.json`);
  }
  for (const codePath of fm.code ?? []) {
    if (!existsSync(join(repoRoot, codePath))) errors.push(`${rel}: в code: нет пути ${codePath}`);
  }
}

if (errors.length > 0) {
  console.error(
    `docs-atoms: ${errors.length} нарушений\n${errors.map((e) => `  ${e}`).join('\n')}`,
  );
  process.exit(1);
}
