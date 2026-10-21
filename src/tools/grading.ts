/**
 * Оценивание: запись оценки и отзыва. Единственная запись, которую видит
 * студент, — поэтому `destructiveHint` и подтверждение хоста.
 */

import { z } from 'zod';
import { WS } from '../api/functions.js';
import { getMoodleClient } from '../api/moodle-client.js';
import {
  describeGradeType,
  htmlToText,
  parseGrade,
  plainToHtml,
  isoTime,
} from '../utils/format.js';
import { assignmentIdSchema, userIdSchema } from '../utils/schemas.js';
import { fetchSubmissionStatus } from './assignments.js';
import { defineTool, reqOpts } from './types.js';

/** Форматы текста Moodle (FORMAT_HTML, FORMAT_MARKDOWN). */
const FORMAT_HTML = 1;
const FORMAT_MARKDOWN = 4;

/** Плагин отзыва-комментария и имя его поля в plugindata. */
const COMMENTS_EDITOR = 'assignfeedbackcomments_editor';

interface ModuleByInstance {
  cm: { id: number; course: number; grade?: number };
}

interface AssignmentsResponse {
  courses: { id: number; assignments: { id: number; grade: number }[] }[];
}

/**
 * Проверка оценки по настройке задания до записи. Moodle сам выход за
 * максимум не отклоняет — значит, лишний ноль в оценке студент увидел бы.
 */
export function validateGrade(gradeSetting: number, grade: number): void {
  const type = describeGradeType(gradeSetting);
  if (type.type === 'none') {
    throw new Error('Задание без оценки (grade = 0): ставить оценку некуда.');
  }
  if (type.type === 'points' && (grade < 0 || grade > type.max)) {
    throw new Error(`Оценка ${grade} вне диапазона задания 0…${type.max}.`);
  }
  if (type.type === 'scale' && (!Number.isInteger(grade) || grade < 1)) {
    throw new Error(
      `Задание оценивается по шкале (id ${type.scaleId}): оценка — номер пункта шкалы, целое от 1.`,
    );
  }
}

export const gradingTools = {
  moodle_save_grade: defineTool({
    description:
      'Ставит оценку участнику за задание и пишет отзыв-комментарий. СТУДЕНТ УВИДИТ ' +
      'оценку и отзыв (сразу или после публикации, если включён процесс оценивания) и ' +
      'может получить уведомление. Вызывать только после явного подтверждения ' +
      'преподавателем оценки и текста. Оценка проверяется по максимуму задания. Если ' +
      'feedback не передан, прежний отзыв сохраняется без изменений.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: z.object({
      assignmentId: assignmentIdSchema,
      userId: userIdSchema,
      grade: z
        .number()
        .min(0)
        .describe('Оценка: баллы от 0 до максимума задания, для шкалы — номер пункта с 1'),
      feedback: z
        .string()
        .optional()
        .describe('Отзыв-комментарий для студента; не передан — прежний отзыв остаётся'),
      feedbackFormat: z
        .enum(['plain', 'markdown', 'html'])
        .default('plain')
        .describe(
          'Формат feedback: plain — простой текст (абзацы через пустую строку), markdown, html',
        ),
      attemptNumber: z.number().int().min(-1).default(-1).describe('Номер попытки; -1 — последняя'),
      addAttempt: z
        .boolean()
        .default(false)
        .describe('Открыть студенту новую попытку (если задание это разрешает)'),
      workflowState: z
        .string()
        .optional()
        .describe(
          'Состояние процесса оценивания (если он включён): notmarked, inmarking, readyforreview, inreview, readyforrelease, released',
        ),
      applyToAll: z
        .boolean()
        .default(true)
        .describe('Для командных заданий — применить оценку ко всей группе'),
    }),
    async execute(args, signal) {
      const opts = reqOpts(signal);
      const client = getMoodleClient();

      // Настройка оценки задания: максимум или шкала.
      const { cm } = await client.call<ModuleByInstance>(
        WS.moduleByInstance,
        { module: 'assign', instance: args.assignmentId },
        opts,
      );
      let gradeSetting = cm.grade;
      if (gradeSetting === undefined) {
        const resp = await client.call<AssignmentsResponse>(
          WS.assignments,
          { courseids: [cm.course] },
          opts,
        );
        gradeSetting = resp.courses
          .flatMap((c) => c.assignments)
          .find((a) => a.id === args.assignmentId)?.grade;
      }
      if (gradeSetting === undefined) {
        throw new Error(`Не удалось прочитать настройку оценки задания ${args.assignmentId}.`);
      }
      validateGrade(gradeSetting, args.grade);

      // Плагин отзывов при сохранении перезаписывает комментарий тем, что
      // пришло в plugindata, — отсутствие поля стёрло бы прежний отзыв.
      // Поэтому без feedback отправляем текущий текст как есть.
      let comment: { text: string; format: number };
      if (args.feedback === undefined) {
        const current = await fetchSubmissionStatus(args.assignmentId, args.userId, opts);
        const field = current.feedback?.plugins?.find((p) => p.type === 'comments')
          ?.editorfields?.[0];
        comment = field
          ? { text: field.text, format: field.format }
          : { text: '', format: FORMAT_HTML };
      } else if (args.feedbackFormat === 'plain') {
        comment = { text: plainToHtml(args.feedback), format: FORMAT_HTML };
      } else {
        comment = {
          text: args.feedback,
          format: args.feedbackFormat === 'markdown' ? FORMAT_MARKDOWN : FORMAT_HTML,
        };
      }

      await client.call<null>(
        WS.saveGrade,
        {
          assignmentid: args.assignmentId,
          userid: args.userId,
          grade: args.grade,
          attemptnumber: args.attemptNumber,
          addattempt: args.addAttempt,
          workflowstate: args.workflowState ?? '',
          applytoall: args.applyToAll,
          plugindata: { [COMMENTS_EDITOR]: comment },
        },
        { ...opts, mutation: true },
      );

      // Читаем обратно: подтверждение — то, что Moodle теперь показывает, а
      // не то, что мы отправили.
      const after = await fetchSubmissionStatus(args.assignmentId, args.userId, opts);
      const field = after.feedback?.plugins?.find((p) => p.type === 'comments')?.editorfields?.[0];
      return {
        saved: true,
        assignmentId: args.assignmentId,
        userId: args.userId,
        grade: parseGrade(after.feedback?.grade?.grade),
        gradeDisplay: after.feedback?.gradefordisplay
          ? htmlToText(after.feedback.gradefordisplay)
          : null,
        gradedAt: isoTime(after.feedback?.gradeddate ?? after.feedback?.grade?.timemodified),
        feedback: field ? htmlToText(field.text) || null : null,
      };
    },
  }),
};
