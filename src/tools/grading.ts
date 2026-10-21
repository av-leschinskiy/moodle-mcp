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
    throw new Error('The assignment has no grade (grade = 0): nothing to grade.');
  }
  if (type.type === 'points' && (grade < 0 || grade > type.max)) {
    throw new Error(`Grade ${grade} is outside the assignment range 0…${type.max}.`);
  }
  if (type.type === 'scale' && (!Number.isInteger(grade) || grade < 1)) {
    throw new Error(
      `The assignment is graded on a scale (id ${type.scaleId}): the grade is the scale item number, an integer from 1.`,
    );
  }
}

export const gradingTools = {
  moodle_save_grade: defineTool({
    description:
      "Saves a participant's grade for an assignment and writes feedback comments. THE STUDENT " +
      'WILL SEE the grade and feedback (immediately, or after release if marking workflow is ' +
      'enabled) and may receive a notification. Call only after the teacher has explicitly ' +
      'confirmed the grade and the text. The grade is checked against the assignment maximum. ' +
      'Feedback is required: Moodle saves the grade and the feedback together, so the text ' +
      'replaces the previous feedback.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: z.object({
      assignmentId: assignmentIdSchema,
      userId: userIdSchema,
      grade: z
        .number()
        .min(0)
        .describe(
          'Grade: points from 0 to the assignment maximum; for a scale, the item number from 1',
        ),
      feedback: z
        .string()
        .trim()
        .min(1)
        .describe('Feedback comments for the student; replaces the previous feedback'),
      feedbackFormat: z
        .enum(['plain', 'markdown', 'html'])
        .default('plain')
        .describe(
          'feedback format: plain — plain text (paragraphs separated by a blank line), markdown, html',
        ),
      attemptNumber: z
        .number()
        .int()
        .min(-1)
        .default(-1)
        .describe('Attempt number; -1 means the latest'),
      addAttempt: z
        .boolean()
        .default(false)
        .describe('Open a new attempt for the student (if the assignment allows it)'),
      workflowState: z
        .string()
        .optional()
        .describe(
          'Marking workflow state (if enabled): notmarked, inmarking, readyforreview, inreview, readyforrelease, released',
        ),
      applyToAll: z
        .boolean()
        .default(true)
        .describe('For group assignments, apply the grade to the whole group'),
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
        throw new Error(`Cannot read the grade setting of assignment ${args.assignmentId}.`);
      }
      validateGrade(gradeSetting, args.grade);

      // Плагин отзывов при сохранении перезаписывает комментарий тем, что
      // пришло в plugindata, поэтому отзыв обязателен: пересылка прежнего
      // текста гоняла бы его через HTML из Moodle и ломала встроенные картинки.
      let comment: { text: string; format: number };
      if (args.feedbackFormat === 'plain') {
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
