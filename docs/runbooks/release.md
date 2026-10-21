---
title: Выпуск версии
description: Как выпустить новую версию в npm и MCP Registry тегом и что настроить один раз. Читать перед выпуском и когда workflow Release упал
tags: [release]
code: [.github/workflows/release.yml, scripts/bump-patch.mjs, scripts/env-docs.mjs]
---

## Симптом

Изменения в `main` нужно донести до пользователей: `npx -y @av-leschinskiy/moodle-mcp`
берёт последнюю версию из npm, а клиенты, читающие MCP Registry, — запись оттуда.

## Диагностика

Выпущенная версия — `npm view @av-leschinskiy/moodle-mcp version`, версия в репозитории —
поле `version` в `package.json`. Pre-commit поднимает patch сам при каждом коммите
с изменениями в `src/`, поэтому между выпусками версия в репозитории обычно уже новее
выпущенной. Минорную или мажорную версию поднимают руками в `package.json` в том же
коммите: ручную правку хук не трогает, а `server.json` перегенерирует.

## Действия

**Выпуск.** Из чистого `main`, совпадающего с `origin/main`:

```bash
git tag "v$(node -p 'require("./package.json").version')" && git push origin --tags
```

Тег запускает workflow Release. Он сверяет тег с версией пакета, гоняет `npm run verify`,
публикует в npm закоммиченный `dist/` и вносит `server.json` в Registry. Токенов и
подтверждения ключом не нужно: в npm workflow входит как доверенный издатель, в Registry —
через OIDC GitHub. Если npm положит версию в «Staged Packages», её подтверждают там на
npmjs.com.

**Разовая настройка npm.** На npmjs.com в настройках пакета, раздел «Trusted Publisher»,
выбрать GitHub Actions: владелец `av-leschinskiy`, репозиторий `moodle-mcp`, файл
workflow `release.yml`, окружение пустое. Без неё шаг `npm publish` падает с 401/403.

**Workflow упал.**

- До `npm publish` — ничего не опубликовано: исправить причину в новом коммите, удалить
  тег (`git push origin :refs/tags/v<версия>` и `git tag -d v<версия>`) и поставить заново.
- На шагах Registry — перезапустить workflow (`gh run rerun <id>`): уже опубликованную
  версию шаг npm пропускает, а перед Registry workflow ждёт, пока npm закончит обработку
  пакета. Опубликованную версию в npm и в Registry перезаписать нельзя — исправление
  выходит следующей версией.
