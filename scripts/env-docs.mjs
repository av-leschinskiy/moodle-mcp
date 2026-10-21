#!/usr/bin/env node
// Генерирует таблицу env-переменных в README.md («Конфигурация») и AGENTS.md
// («Environment»), .env.example и server.json для MCP Registry из zod-схемы
// `envSchema` в src/config.ts.
//
//   node scripts/env-docs.mjs           — перезаписать блоки
//   node scripts/env-docs.mjs --check   — только проверить (exit 1 при расхождении)
//
// Зачем: та же болезнь, что была у таблицы тулов — один список жил в трёх
// местах (схема, README, AGENTS.md) и расходился. Источник истины — схема:
// имя, обязательность и default берутся из неё, человекочитаемое описание —
// из `.describe()` поля.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const BEGIN = '<!-- BEGIN:env-table (сгенерировано scripts/env-docs.mjs) -->';
const END = '<!-- END:env-table -->';
const TARGETS = ['README.md', 'AGENTS.md'];
/** Переменные с секретом: Registry показывает их клиентам как скрытые поля. */
const SECRET_ENV = new Set(['MOODLE_TOKEN']);

// Источник истины — собранный dist (он же коммитится). Импорт без побочных
// эффектов: getConfig ленивый, env на этапе импорта не читается.
let mod;
try {
  mod = await import(pathToFileURL(resolve(repoRoot, 'dist/config.js')).href);
} catch (err) {
  console.error(
    `env-docs: не удалось прочитать dist/config.js (${err.message}). Сначала: npm run build`,
  );
  process.exit(1);
}

const { envSchema, ENV_DISPLAY_DEFAULTS } = mod;
if (!envSchema?.shape) {
  console.error('env-docs: dist/config.js не экспортирует envSchema — поправьте src/config.ts.');
  process.exit(1);
}

/** Разворачивает ZodDefault/ZodOptional до базового типа, собирая метаданные. */
function unwrap(schema) {
  let current = schema;
  let defaultValue;
  let optional = false;
  for (;;) {
    const { typeName } = current._def;
    if (typeName === 'ZodDefault') {
      defaultValue = current._def.defaultValue();
      current = current._def.innerType;
    } else if (typeName === 'ZodOptional') {
      optional = true;
      current = current._def.innerType;
    } else {
      return { defaultValue, optional };
    }
  }
}

const missing = [];
const rows = Object.entries(envSchema.shape).map(([name, schema]) => {
  const description = schema._def.description;
  if (!description) missing.push(name);
  const { defaultValue, optional } = unwrap(schema);
  const shown = ENV_DISPLAY_DEFAULTS?.[name] ?? defaultValue;
  return {
    name,
    required: defaultValue === undefined && !optional,
    default: shown === undefined ? '—' : `\`${shown}\``,
    description: description ?? '',
  };
});

if (missing.length > 0) {
  console.error(
    `env-docs: у полей нет .describe(): ${missing.join(', ')}. ` +
      'Описание живёт в схеме — добавьте его в src/config.ts.',
  );
  process.exit(1);
}

const table = [
  '| Переменная | Обяз. | По умолчанию | Описание |',
  '|---|:---:|---|---|',
  ...rows.map(
    (r) => `| \`${r.name}\` | ${r.required ? 'да' : '—'} | ${r.default} | ${r.description} |`,
  ),
].join('\n');

/**
 * `.env.example` целиком генерируется из той же схемы. Раньше он правился
 * руками и был четвёртой копией знания о переменных (схема, README, AGENTS.md,
 * пример) — причём единственной без проверки: таблицы сверяет `--check`, а
 * пример молча расходился бы.
 *
 * Обязательные переменные раскомментированы (без них сервер не стартует),
 * опциональные — закомментированы со значением по умолчанию.
 */
function renderEnvExample() {
  const lines = [
    '# Сгенерировано scripts/env-docs.mjs из envSchema в src/config.ts —',
    '# руками не править, запусти `npm run docs:env`.',
    '#',
    '# Скопируй в .env и заполни обязательные переменные.',
  ];
  for (const row of rows) {
    const shown = row.default === '—' ? '' : row.default.replaceAll('`', '');
    lines.push('', `# ${row.description}`);
    lines.push(row.required ? `${row.name}=` : `# ${row.name}=${shown}`);
  }
  return lines.join('\n') + '\n';
}

let stale = false;
for (const rel of TARGETS) {
  const path = resolve(repoRoot, rel);
  const text = readFileSync(path, 'utf8');
  const beginIdx = text.indexOf(BEGIN);
  const endIdx = text.indexOf(END);
  if (beginIdx === -1 || endIdx === -1) {
    console.error(`env-docs: в ${rel} нет маркеров ${BEGIN} / ${END}.`);
    process.exit(1);
  }

  const next =
    text.slice(0, beginIdx + BEGIN.length) + '\n\n' + table + '\n\n' + text.slice(endIdx);
  if (next === text) continue;

  stale = true;
  if (!process.argv.includes('--check')) writeFileSync(path, next);
  console.error(`env-docs: ${rel} ${process.argv.includes('--check') ? 'разошёлся' : 'обновлён'}.`);
}

/**
 * `server.json` — запись сервера для MCP Registry. Имя, версия, описание и
 * репозиторий берутся из package.json (`mcpName` Registry сверяет с
 * опубликованным пакетом), переменные — из той же схемы, что таблицы выше.
 */
function renderServerJson() {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
  const server = {
    $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
    name: pkg.mcpName,
    description: pkg.description,
    repository: {
      url: pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, ''),
      source: 'github',
    },
    version: pkg.version,
    packages: [
      {
        registryType: 'npm',
        identifier: pkg.name,
        version: pkg.version,
        transport: { type: 'stdio' },
        environmentVariables: rows.map((r) => ({
          name: r.name,
          description: r.description.replaceAll('`', ''),
          isRequired: r.required,
          format: 'string',
          ...(SECRET_ENV.has(r.name) ? { isSecret: true } : {}),
        })),
      },
    ],
  };
  return JSON.stringify(server, null, 2) + '\n';
}

const serverJsonPath = resolve(repoRoot, 'server.json');
const serverJsonNext = renderServerJson();
let serverJsonPrev = '';
try {
  serverJsonPrev = readFileSync(serverJsonPath, 'utf8');
} catch {
  // Файла ещё нет — создадим.
}
if (serverJsonPrev !== serverJsonNext) {
  stale = true;
  if (!process.argv.includes('--check')) writeFileSync(serverJsonPath, serverJsonNext);
  console.error(
    `env-docs: server.json ${process.argv.includes('--check') ? 'разошёлся' : 'обновлён'}.`,
  );
}

const examplePath = resolve(repoRoot, '.env.example');
const exampleNext = renderEnvExample();
if (readFileSync(examplePath, 'utf8') !== exampleNext) {
  stale = true;
  if (!process.argv.includes('--check')) writeFileSync(examplePath, exampleNext);
  console.error(
    `env-docs: .env.example ${process.argv.includes('--check') ? 'разошёлся' : 'обновлён'}.`,
  );
}

if (stale && process.argv.includes('--check')) {
  console.error('env-docs: документация разошлась со схемой. Выполните: npm run docs:env');
  process.exit(1);
}
if (!stale && !process.argv.includes('--check')) {
  console.error(`env-docs: таблицы актуальны (${rows.length} переменных).`);
}
