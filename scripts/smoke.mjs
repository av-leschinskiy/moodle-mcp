#!/usr/bin/env node
// Смоук по живому Moodle: цепочка тулов только на чтение.
//
//   MOODLE_URL=https://moodle.example.org npm run smoke
//
// site_info → list_courses → list_assignments (первый курс с заданиями) →
// list_submissions → list_pending_submissions (тот же курс) → get_submission
// (первая сдача). Печатает только факт успеха и количества — ни имён, ни
// текстов: в ответах личные данные студентов, а вывод смоука оседает в логах
// и терминалах.
//
// Тул вызывается, только если у него `readOnlyHint` в annotations: станет
// тул пишущим — смоук откажется его звать, а не поставит оценку.

import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { allTools } = await import(pathToFileURL(resolve(repoRoot, 'dist/tools/index.js')).href);

async function run(name, args) {
  const tool = allTools[name];
  if (tool?.annotations?.readOnlyHint !== true) {
    throw new Error(`${name} не помечен readOnlyHint — смоук его не вызывает.`);
  }
  const parsed = tool.inputSchema.parse(args);
  return tool.execute(parsed);
}

function ok(name, detail) {
  console.error(`ok  ${name}${detail ? ` — ${detail}` : ''}`);
}

try {
  const info = await run('moodle_site_info', {});
  ok('moodle_site_info', `Moodle ${info.site.release ?? '?'}, недоступных функций: ${info.missingFunctions.length}`);

  const courses = await run('moodle_list_courses', {});
  ok('moodle_list_courses', `курсов: ${courses.items.length}`);

  let assignment;
  let courseId;
  for (const course of courses.items) {
    const list = await run('moodle_list_assignments', { courseId: course.id });
    if (list.items.length > 0) {
      ok('moodle_list_assignments', `заданий в курсе: ${list.items.length}`);
      assignment = list.items[0];
      courseId = course.id;
      break;
    }
  }
  if (!assignment) {
    console.error('—   заданий ни в одном курсе нет, дальше проверять нечего');
    process.exit(0);
  }

  const subs = await run('moodle_list_submissions', { assignmentId: assignment.id });
  ok(
    'moodle_list_submissions',
    `участников: ${subs.counts.participants}, сдали: ${subs.counts.submitted}, ` +
      `ждут оценки: ${subs.counts.needsGrading}, оценено: ${subs.counts.graded}, ` +
      `требуют внимания: ${subs.counts.needsAttention}`,
  );

  const pending = await run('moodle_list_pending_submissions', { courseId, status: 'open' });
  ok(
    'moodle_list_pending_submissions',
    `заданий: ${pending.assignments}, незакрытых сдач по состояниям: ${JSON.stringify(pending.counts)}`,
  );

  const first = subs.items.find((s) => s.status === 'submitted');
  if (first) {
    const sub = await run('moodle_get_submission', { assignmentId: assignment.id, userId: first.userId });
    ok(
      'moodle_get_submission',
      `текст: ${sub.onlineText ? 'есть' : 'нет'}, файлов: ${sub.files.length}, оценка: ${sub.grade.value === null ? 'нет' : 'есть'}, ` +
        `комментариев: ${sub.comments === null ? 'недоступны' : sub.comments.length}`,
    );
  }
} catch (err) {
  console.error(`FAIL ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
