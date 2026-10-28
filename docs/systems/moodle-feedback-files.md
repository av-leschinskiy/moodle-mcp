---
title: Файлы в отзыве-комментарии Moodle
description: Как Moodle принимает картинки внутри текста отзыва к заданию — черновик upload.php, форма оценки, @@PLUGINFILE@@ — и почему mod_assign_save_grade для этого не годится. Читать перед правкой записи отзыва с файлами
tags: [moodle-api, grading]
code: [src/api/moodle-client.ts, src/tools/grading.ts]
---

## Контракт

Картинка в отзыве плагина `assignfeedback_comments` — файл его области `feedback` у записи
оценки. Текст отзыва ссылается на файл как `@@PLUGINFILE@@/<имя>`; при показе Moodle
подставляет адрес файла. Файл попадает в область только из черновика пользователя: при
сохранении плагин вызывает `file_postupdate_standard_editor`, и та переносит файлы черновика
с `itemid` из данных редактора. Без `itemid` текст сохраняется как есть, а ссылка остаётся
битой.

- **Черновик** — `POST webservice/upload.php`, multipart: `token`, `itemid` (0 — новый
  черновик), `filepath`, файл. Ответ — JSON-массив записей с `itemid` и `filename`; отказ по
  файлу (размер, занятое имя) — элемент с `errortype`; исключение — объект `{error,
  errorcode}`, как у AJAX-скриптов, а не `{exception}`, как у `server.php`. Параметр
  `filearea` скрипт не читает: файл всегда ложится в `user/draft`. Имя проходит
  `clean_param(PARAM_FILE)`.
- **Право загрузки** — флаг `uploadfiles` сервиса, к которому выдан токен; при нуле
  `upload.php` отвечает `accessexception` «Web service file upload must be enabled in
  external service settings». Флаг и предел размера для пользователя отдаёт
  `core_webservice_get_site_info` (`uploadfiles`, `usermaxuploadfilesize`). У встроенного
  сервиса `moodle_mobile_app` флаг включён в его определении (`lib/db/services.php`).
- **Запись с файлами** — `mod_assign_submit_grading_form`: `jsonformdata` — JSON-строка,
  внутри которой строка формы в URL-кодировании (`grade`, `attemptnumber`,
  `assignfeedbackcomments_editor[text|format|itemid]` и прочие поля формы оценки). Ответ —
  список предупреждений; `couldnotsavegrade` «Form validation failed» означает, что форма
  данные не приняла и ничего не записано.

## Поведение

- **`mod_assign_save_grade` файлы отзыва не принимает.** Структура
  `plugindata[assignfeedbackcomments_editor]` описана только полями `text` и `format`
  (`get_external_parameters` плагина, одинаково в 4.1–5.x), а лишний ключ `itemid` проверка
  параметров отклоняет «Unexpected keys (itemid)».
- **Картинка data-URI не выживает.** Текст при показе чистит HTMLPurifier, а схема `data:`
  не входит в разрешённые: тег `<img>` пропадёт.
- **Черновик заменяет файлы области.** Перенос синхронизирует область отзыва с черновиком:
  картинки прежнего отзыва, которых нет в новом черновике, удаляются.
- **Форма оценки строже `save_grade`:** она сама проверяет оценку по максимуму и шкале,
  поля, которых нет в форме задания (оценивание по процессу, группа, попытки), молча
  игнорирует, а без `sendstudentnotifications` уведомляет студента — как и `save_grade`.
  Сессионный ключ для веб-сервиса не нужен: функция сама ставит `ignoresesskey`.
- **Черновик невидим студенту** и живёт несколько дней: незавершённая загрузка следов в
  задании не оставляет.

## Как с ней работать

Загрузка — `MoodleClient.uploadDraftFile`, запись — ветка с картинками в
`moodle_save_grade`; модель возможности — [Картинки в отзыве](../features/feedback-images.md).
