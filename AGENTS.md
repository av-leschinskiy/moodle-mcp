# AGENTS.md

Инструкции для агентов (Claude Code, Codex и др.) при работе с этим репозиторием.
`CLAUDE.md` — симлинк на этот файл.

## Проект

MCP-сервер над REST API веб-сервисов Moodle: курсы, задания (`mod_assign`),
сдачи, файлы сдач, оценивание. Сервер общий для любого Moodle: в коде, тестах и
документации нет имён конкретных сайтов, курсов и людей (кроме адреса-примера
`moodle.example.org`). Состав тулов — раздел «Что внутри» в README
(генерируется из `allTools`).

CI нет: барьер — pre-commit (см. «Грабли») и `npm run verify` перед пушем.

`docs/` ведётся атомами по скиллу `writing-doc-atoms`, словарь тегов —
`docs/_tags.json`, нормы проекта — [Нормы документации](docs/conventions/documentation.md).

## Правила

- **Токен не печатать.** Ни в stdout, ни в логи, ни в тексты ошибок и ответы
  тулов. Файл токена читает только код сервера (`src/auth/token-store.ts`);
  `cat`/`grep`/`jq` по нему не запускать. Ошибки разбора файла не цитируют его
  содержимое (`SyntaxError` из `JSON.parse` цитирует). Всё, что уходит наружу,
  проходит `scrub` из `src/api/moodle-client.ts`: клиент чистит ошибки,
  `server.ts` — каждый ответ тула целиком.
- **Запись — только с подтверждением человека.** `destructiveHint: true` стоит
  только на записи, видимой студентам (оценка, отзыв); описание такого тула
  прямо говорит, что студент увидит результат. Против живого сайта при
  разработке запись не вызывается вообще — проверка на подставном `fetch`.
- **Личные данные студентов** не попадают в тесты, фикстуры, коммиты и вывод
  смоука: фикстуры синтетические (`src/testing/fake-moodle.ts`), смоук печатает
  только количества.
- **Stdout занят MCP-протоколом.** `console.log` перехватывает
  `src/stdout-guard.ts` (первый импорт `index.ts`); логгер
  `src/utils/logger.ts` пишет в stderr и в канал хоста.

## Команды

```bash
npm run dev          # tsx (без компиляции)
npm run build        # нативный tsc 7 → dist/ (prebuild стэмпит src/version.ts)
npm run verify:fast  # typecheck + lint
npm run verify       # + тесты и docs:check
npm run smoke        # цепочка тулов на чтение по живому Moodle (нужны MOODLE_URL и токен)
npm run login        # moodle-mcp-login из исходников
```

Полный список — `scripts` в `package.json`. **`npx tsc` не вызывать** — см.
«TypeScript».

## Архитектура

- **Вход:** `src/index.ts` (stdout-guard, коды выхода: 1 — ошибка старта,
  2 — runtime-крах) → `src/server.ts` (`McpServer`, регистрация тулов из
  `src/tools/index.ts`, обёртка ответа в text + `structuredContent`, потолок
  текста `MAX_TEXT_CHARS`, маппинг ошибок, `SERVER_INSTRUCTIONS`).
- **Конфиг:** `src/config.ts` — zod-схема `envSchema` над снимком env (пустые
  строки = «не задано»). Она же источник таблиц env в README и ниже.
- **Клиент:** `src/api/moodle-client.ts` — `MoodleClient.call(wsfunction,
  params)`: POST на `webservice/rest/server.php`, параметры разворачивает
  `encodeParams` в формат Moodle (`ids[0]=5`, `plugindata[x][text]=…`).
  Исключение Moodle приходит с HTTP 200 и телом `{exception, errorcode,
  message}` — успех определяется по телу. Коды из `AUTH_ERROR_CODES` → `kind:
  'auth'` с подсказкой про `moodle-mcp-login`, остальные → `kind: 'moodle'`.
  Ретраи только для чтения; вызов с `mutation: true` не повторяется. Файлы —
  `openFile`: ссылка приводится к `webservice/pluginfile.php` этого же сайта
  (чужой хост отклоняется, чтобы токен не ушёл наружу), токен добавляется только
  в сам запрос. Доступ к клиенту — через ALS (`runWithClient` в server.ts) с
  ленивым singleton для смоука; тесты подменяют `getMoodleClient` через
  `vi.spyOn`.
- **Имена функций API:** `src/api/functions.ts` (`WS`) — единственный список;
  `moodle_site_info` сверяет его с функциями, которые открывает токен.
- **Токен:** `src/auth/token-store.ts` — файл `{"site","token","privatetoken"}`
  (0600, атомарная запись через rename), `getToken()` — `MOODLE_TOKEN` либо
  файл с проверкой, что сайт совпал с `MOODLE_URL`.
- **Логин:** модель, инварианты и причины устройства —
  [Вход в Moodle и токен сервера](docs/features/login.md). Протокол —
  `src/auth/launch.ts` (чистые функции, покрыты тестами), браузер —
  `src/cli/chrome.ts`; `src/cli/login.ts` исполняет `main()` на импорте,
  поэтому логики в нём нет.
- **Форматирование ответов:** `src/utils/format.ts` — HTML → текст, текст →
  HTML для отзыва, unix-время → ISO, оценка `-1` → `null`, знак поля `grade`
  задания (баллы / шкала / без оценки).
- **Версия:** `src/version.ts` генерирует `scripts/stamp-version.mjs` (prebuild);
  `BASE_COMMIT` — родитель коммита, в который попала сборка, точная метка —
  `VERSION` (её бампает pre-commit).

## Как добавить тул

1. Описать тул в модуле `src/tools/<module>.ts` через `defineTool` (связывает
   `inputSchema` и тип `args`):

   ```typescript
   moodle_my_action: defineTool({
     description: 'Что делает, когда звать, откуда брать параметры.',
     annotations: { readOnlyHint: true, idempotentHint: true },
     inputSchema: z.object({ assignmentId: assignmentIdSchema }),
     async execute(args, signal) {
       const data = await getMoodleClient().call<MyResponse>(
         WS.myFunction,
         { assignid: args.assignmentId },
         reqOpts(signal),
       );
       return { items: data.map(compact) };
     },
   }),
   ```

2. Имя функции API — в `WS` (`src/api/functions.ts`), не строкой по месту.
3. Входные имена не копируют транспорт: наружу `assignmentId`, внутри —
   `assignid`/`assignmentids` (у разных функций Moodle по-разному).
   Переиспользуемые схемы — `src/utils/schemas.ts`.
4. Ответ сворачивать: только поля, нужные для решения, без email и прочих
   персональных полей, HTML — через `htmlToText`. Интерфейс ответа Moodle
   описывать узко — только используемые поля.
5. `destructiveHint: true` — только если результат увидят студенты; такой тул
   зовёт клиент с `mutation: true`, а в описании пишет, что увидит студент.
6. Тест на подставном Moodle (`stubMoodle` из `src/testing/fake-moodle.ts`):
   какие параметры ушли и что вернулось.
7. Новый модуль — экспорт в `src/tools/index.ts` и запись в `CATEGORIES`
   `scripts/tool-docs.mjs` (без неё генератор падает). README руками не
   править: таблицы перегенерирует pre-commit.

## TypeScript

Компилятор — нативный TypeScript 7 (`@typescript/native`); `typescript-eslint`
требует JS-API, которого в 7.0 нет, поэтому рядом стоит TS 6 под именем
`typescript`. Оба регистрируют bin `tsc`, и кто займёт `node_modules/.bin/tsc`,
зависит от порядка установки. Единственный вход в компилятор —
`scripts/tsc.mjs` (через `build`, `watch`, `typecheck`). `tsconfig.json`
исключает из сборки тесты и `src/testing/`; `tsconfig.typecheck.json` проверяет
всё.

## Environment

Таблица генерируется из `envSchema` в `src/config.ts` (`npm run docs:env`) —
руками не править, описание переменной живёт в её `.describe()`.

<!-- BEGIN:env-table (generated by scripts/env-docs.mjs) -->

| Variable | Required | Default | Description |
|---|:---:|---|---|
| `MOODLE_URL` | yes | — | Moodle site address (wwwroot), e.g. `https://moodle.example.org` |
| `MOODLE_TOKEN_FILE` | — | `~/.config/mcp-moodle/token.json` | Where `moodle-mcp-login` saves the token (path is resolved via `homedir()`) |
| `MOODLE_TOKEN` | — | — | Web service token override (CI / smoke tests) |
| `MOODLE_TIMEOUT` | — | `30000` | Timeout of a single API request (ms) |
| `MOODLE_CHROME` | — | — | Chrome/Chromium binary for `moodle-mcp-login` (looked up in PATH by default) |
| `MOODLE_DEBUG` | — | `false` | `1`/`true`/`yes`/`on` enables debug output to stderr and `debug` level in the host log channel |

<!-- END:env-table -->

## Тесты

Vitest, тесты рядом с исходником (`*.test.ts`). HTTP подменяется глобальным
`fetch`: `stubMoodle` отвечает по `wsfunction` и записывает отправленные
параметры. `server.test.ts` поднимает настоящий `McpServer` через
`InMemoryTransport` — проверяется то, что видит хост: схемы, annotations,
обёртка ответа, ошибки, вычистка токена.

Смоук по живому сайту (`scripts/smoke.mjs`) зовёт только тулы с `readOnlyHint`
и печатает количества, без имён.

## Грабли

- **`dist/` коммитится**, чтобы `npx git+ssh://…` работал без сборки. Хуки в
  `.githooks/` подключает `npm install` (`prepare` → `core.hooksPath`); без
  установки зависимостей хук молча не сработает.
- **Отзыв при сохранении оценки.** Плагин комментариев перезаписывает отзыв
  тем, что пришло в `plugindata`; без поля он был бы стёрт. Поэтому
  `moodle_save_grade` без `feedback` отправляет текущий отзыв обратно.
- **Moodle не отклоняет оценку выше максимума** — `validateGrade` проверяет
  диапазон по настройке задания до записи.
- **Проходной балл** не отдаёт `mod_assign_get_assignments`; он берётся из
  модуля курса (`core_course_get_course_module`), по запросу на задание.
- **Подпись launch.php** считается от wwwroot сайта: `MOODLE_URL` с другой
  схемой, хостом или путём, чем у сайта, даст «Moodle response signature
  mismatch». Слэш на конце не мешает — `normalizeSiteUrl` его срезает.
