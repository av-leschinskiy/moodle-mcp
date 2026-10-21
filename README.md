# Moodle MCP Server

MCP-сервер для AI-ассистентов (Claude Code, Cursor, Codex и другие stdio-клиенты)
над REST API веб-сервисов [Moodle](https://moodle.org). Даёт ассистенту видеть
курсы, задания и сдачи студентов, скачивать файлы сдач и ставить оценку с
отзывом — от имени преподавателя и только после его подтверждения.

Сервер общий для любого Moodle с включённым мобильным веб-сервисом
(`moodle_mobile_app`): токен выдаётся так же, как мобильному приложению Moodle,
поэтому подходит и вход через внешнего OAuth-провайдера с капчей.

## Пререквизиты

- [Node.js](https://nodejs.org/) ≥ 22.
- Google Chrome или Chromium — для команды входа `moodle-mcp-login`.
- На сайте Moodle включён доступ мобильного приложения (Администрирование →
  Мобильное приложение). Проверить: адрес `<сайт>/admin/tool/mobile/launch.php`
  должен открываться, а не отвечать ошибкой.

## Быстрый старт

Пример ниже — для сайта `https://moodle.example.org`; подставьте адрес своего
Moodle в точности так, как он выглядит в браузере (схема, хост, путь; слэш на
конце не важен).

1. Войти — один раз на машине и заново, когда тул ответит ошибкой входа
   ([Вход в Moodle и токен сервера](docs/features/login.md)):

   ```bash
   MOODLE_URL=https://moodle.example.org npx -y -p @av-leschinskiy/moodle-mcp moodle-mcp-login
   ```

   Откроется окно Chrome: войдите на сайт как обычно, капчу проходите сами.
   Команда напишет «Вошёл как <имя> на <сайт>» и закроет окно. Без `-p` npx
   запустил бы сервер, а не вход. Chrome ищется в PATH; на macOS и Windows
   путь к нему задаёт `MOODLE_CHROME`.

2. Подключить сервер к клиенту. Claude Code:

   ```bash
   claude mcp add moodle -e MOODLE_URL=https://moodle.example.org -- npx -y @av-leschinskiy/moodle-mcp
   ```

   `-s user` — для всех проектов, без него — только для текущего.

   Codex — командой или блоком в `~/.codex/config.toml`:

   ```bash
   codex mcp add moodle --env MOODLE_URL=https://moodle.example.org -- npx -y @av-leschinskiy/moodle-mcp
   ```

   ```toml
   [mcp_servers.moodle]
   command = "npx"
   args = ["-y", "@av-leschinskiy/moodle-mcp"]
   env = { MOODLE_URL = "https://moodle.example.org" }
   ```

   Cursor и другие клиенты — stdio-сервер с командой
   `npx -y @av-leschinskiy/moodle-mcp` и переменной `MOODLE_URL`:

   ```json
   {
     "mcpServers": {
       "moodle": {
         "command": "npx",
         "args": ["-y", "@av-leschinskiy/moodle-mcp"],
         "env": { "MOODLE_URL": "https://moodle.example.org" }
       }
     }
   }
   ```

3. Проверить: попросите ассистента «покажи мои курсы в Moodle».

Из клона репозитория вместо `npx` — `node <клон>/dist/index.js` и
`node <клон>/dist/cli/login.js`: `dist/` закоммичен, сборка не нужна.

## Что внутри

<!-- BEGIN:tools-table (сгенерировано scripts/tool-docs.mjs) -->

Всего **7 тулов**, из них **1** требуют подтверждения пользователя.

| Категория | Тулов | Подтверждение | Что покрывает |
|---|---:|---:|---|
| **Сайт** | 2 | — | кто я, версия Moodle, доступные функции, мои курсы |
| **Задания и сдачи** | 3 | — | задания курса, участники и статусы сдач, сдача целиком |
| **Файлы** | 1 | — | скачивание файлов сдачи на диск |
| **Оценивание** | 1 | 1 | оценка и отзыв студенту |

<details>
<summary>Полный список имён</summary>

**Сайт**

- `moodle_list_courses`
- `moodle_site_info`

**Задания и сдачи**

- `moodle_get_submission`
- `moodle_list_assignments`
- `moodle_list_submissions`

**Файлы**

- `moodle_download_file`

**Оценивание**

- `moodle_save_grade` — подтверждение

</details>

<!-- END:tools-table -->

Сервер работает **от вашего имени**: видит и меняет то же, что вы в интерфейсе
Moodle. Подтверждение хоста запрашивается только за запись, которую увидят
студенты, — оценку и отзыв (`destructiveHint: true`). Скачивание файла тоже
пишет, но лишь на ваш диск, и подтверждения не требует.

Ответы сокращены под контекст модели: HTML описаний и сдач переведён в простой
текст, время — в ISO, оценка «не выставлена» — `null`, email участников наружу не
отдаётся.

## Конфигурация

<!-- BEGIN:env-table (сгенерировано scripts/env-docs.mjs) -->

| Переменная | Обяз. | По умолчанию | Описание |
|---|:---:|---|---|
| `MOODLE_URL` | да | — | Адрес сайта Moodle (wwwroot), например `https://moodle.example.org` |
| `MOODLE_TOKEN_FILE` | — | `~/.config/mcp-moodle/token.json` | Куда `moodle-mcp-login` сохраняет токен (путь резолвится через `homedir()`) |
| `MOODLE_TOKEN` | — | — | Override токена веб-сервиса (CI / смок-тесты) |
| `MOODLE_TIMEOUT` | — | `30000` | Таймаут одного запроса к API (мс) |
| `MOODLE_CHROME` | — | — | Бинарь Chrome/Chromium для `moodle-mcp-login` (по умолчанию ищется в PATH) |
| `MOODLE_DEBUG` | — | `false` | `1`/`true`/`yes`/`on` — отладочный вывод в stderr и уровень `debug` в канал хоста |

<!-- END:env-table -->

Файл токена лежит с правами `0600` и хранит адрес сайта, для которого выпущен:
если он не совпал с `MOODLE_URL`, сервер попросит выполнить `moodle-mcp-login`.
Сервер читает файл на каждый запрос, поэтому после перелогина хост
перезапускать не нужно. Токен вычищается из текстов ошибок, логов и ответов
тулов (в том числе из ссылок на файлы).

Профиль Chrome для входа хранится отдельно от вашего основного
(`~/.config/mcp-moodle/chrome-profile`): cookies сайта сохраняются, и повторный
вход часто проходит без пароля.

## Разработка

```bash
npm install        # заодно подключает git-хуки (.githooks)
npm run dev        # tsx, без компиляции
npm run build      # нативный TypeScript 7 → dist/
npm run verify     # typecheck + lint + тесты + сверка документации
MOODLE_URL=… npm run smoke   # цепочка тулов на чтение по живому Moodle
```

Собирать только через `npm run build`: в `devDependencies` две версии
компилятора, [подробности](AGENTS.md#typescript). `dist/` коммитится;
pre-commit сам собирает и стейджит его, бампает patch-версию и перегенерирует
таблицы выше. Архитектура и правила — в [AGENTS.md](AGENTS.md).
