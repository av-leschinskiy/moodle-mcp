/**
 * Действия проверяющего, которые видит студент: оценка и отзыв, комментарий
 * к сдаче, возврат сдачи на доработку. Поэтому у каждого тула
 * `destructiveHint` и подтверждение хоста.
 */
import { z } from 'zod';
import { WS } from '../api/functions.js';
import { getMoodleClient } from '../api/moodle-client.js';
import { describeGradeType, htmlToText, parseGrade, plainToHtml, isoTime, } from '../utils/format.js';
import { assignmentIdSchema, userIdSchema } from '../utils/schemas.js';
import { compactComment, fetchSubmissionStatus, submissionCommentArea, } from './assignments.js';
import { defineTool, reqOpts } from './types.js';
/** Форматы текста Moodle (FORMAT_HTML, FORMAT_MARKDOWN). */
const FORMAT_HTML = 1;
const FORMAT_MARKDOWN = 4;
/** Плагин отзыва-комментария и имя его поля в plugindata. */
const COMMENTS_EDITOR = 'assignfeedbackcomments_editor';
/**
 * Проверка оценки по настройке задания до записи. Moodle сам выход за
 * максимум не отклоняет — значит, лишний ноль в оценке студент увидел бы.
 */
export function validateGrade(gradeSetting, grade) {
    const type = describeGradeType(gradeSetting);
    if (type.type === 'none') {
        throw new Error('The assignment has no grade (grade = 0): nothing to grade.');
    }
    if (type.type === 'points' && (grade < 0 || grade > type.max)) {
        throw new Error(`Grade ${grade} is outside the assignment range 0…${type.max}.`);
    }
    if (type.type === 'scale' && (!Number.isInteger(grade) || grade < 1)) {
        throw new Error(`The assignment is graded on a scale (id ${type.scaleId}): the grade is the scale item number, an integer from 1.`);
    }
}
/** Сдача участника или его группы; нет сдачи — отказ с понятным текстом. */
function requireSubmission(status, userId) {
    const sub = status.lastattempt?.submission ?? status.lastattempt?.teamsubmission;
    if (!sub || sub.status === 'new') {
        throw new Error(`Participant ${userId} has no submission for this assignment.`);
    }
    return sub;
}
export const gradingTools = {
    moodle_save_grade: defineTool({
        description: "Saves a participant's grade for an assignment and writes feedback comments. THE STUDENT " +
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
                .describe('Grade: points from 0 to the assignment maximum; for a scale, the item number from 1'),
            feedback: z
                .string()
                .trim()
                .min(1)
                .describe('Feedback comments for the student; replaces the previous feedback'),
            feedbackFormat: z
                .enum(['plain', 'markdown', 'html'])
                .default('plain')
                .describe('feedback format: plain — plain text (paragraphs separated by a blank line), markdown, html'),
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
                .describe('Marking workflow state (if enabled): notmarked, inmarking, readyforreview, inreview, readyforrelease, released'),
            applyToAll: z
                .boolean()
                .default(true)
                .describe('For group assignments, apply the grade to the whole group'),
        }),
        async execute(args, signal) {
            const opts = reqOpts(signal);
            const client = getMoodleClient();
            // Настройка оценки задания: максимум или шкала.
            const { cm } = await client.call(WS.moduleByInstance, { module: 'assign', instance: args.assignmentId }, opts);
            let gradeSetting = cm.grade;
            if (gradeSetting === undefined) {
                const resp = await client.call(WS.assignments, { courseids: [cm.course] }, opts);
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
            let comment;
            if (args.feedbackFormat === 'plain') {
                comment = { text: plainToHtml(args.feedback), format: FORMAT_HTML };
            }
            else {
                comment = {
                    text: args.feedback,
                    format: args.feedbackFormat === 'markdown' ? FORMAT_MARKDOWN : FORMAT_HTML,
                };
            }
            await client.call(WS.saveGrade, {
                assignmentid: args.assignmentId,
                userid: args.userId,
                grade: args.grade,
                attemptnumber: args.attemptNumber,
                addattempt: args.addAttempt,
                workflowstate: args.workflowState ?? '',
                applytoall: args.applyToAll,
                plugindata: { [COMMENTS_EDITOR]: comment },
            }, { ...opts, mutation: true });
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
    moodle_add_submission_comment: defineTool({
        description: "Adds a comment to a participant's submission (the comments thread under the submission, " +
            'separate from feedback). THE STUDENT WILL SEE the comment and may receive a notification. ' +
            'Call only after the teacher has explicitly confirmed the text. Existing comments are in ' +
            'moodle_get_submission.',
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
        inputSchema: z.object({
            assignmentId: assignmentIdSchema,
            userId: userIdSchema,
            text: z.string().trim().min(1).describe('Comment text, plain text'),
        }),
        async execute(args, signal) {
            const opts = reqOpts(signal);
            const sub = requireSubmission(await fetchSubmissionStatus(args.assignmentId, args.userId, opts), args.userId);
            const area = await submissionCommentArea(args.assignmentId, sub.id, opts);
            const [added] = await getMoodleClient().call(WS.addComments, { comments: [{ ...area, content: args.text }] }, { ...opts, mutation: true });
            return {
                added: true,
                assignmentId: args.assignmentId,
                userId: args.userId,
                comment: added ? compactComment(added) : null,
            };
        },
    }),
    moodle_revert_submission_to_draft: defineTool({
        description: "Returns a participant's submitted work for rework: the submission goes back to draft, " +
            'the student can edit it and submit again while the assignment accepts submissions (due ' +
            'and cut-off dates or an extension). THE STUDENT WILL SEE the status change. The grade and ' +
            'feedback stay; for a group submission the whole group is affected. Use it when the ' +
            'assignment allows one attempt; explain the reason to the student with feedback or ' +
            'moodle_add_submission_comment. Call only after the teacher has explicitly confirmed.',
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
        inputSchema: z.object({ assignmentId: assignmentIdSchema, userId: userIdSchema }),
        async execute(args, signal) {
            const opts = reqOpts(signal);
            const sub = requireSubmission(await fetchSubmissionStatus(args.assignmentId, args.userId, opts), args.userId);
            // Moodle переводит в черновик любую сдачу, даже уже черновик, и при этом
            // пишет в журнал оценок; отказываем до записи.
            if (sub.status !== 'submitted') {
                throw new Error(`Submission of participant ${args.userId} is "${sub.status}", not submitted: nothing to revert.`);
            }
            // Неудача приходит не исключением, а списком предупреждений.
            const warnings = await getMoodleClient().call(WS.revertToDraft, { assignmentid: args.assignmentId, userids: [args.userId] }, { ...opts, mutation: true });
            if (warnings.length > 0) {
                const detail = warnings.map((w) => w.message ?? w.warningcode).join('; ');
                throw new Error(`Moodle did not revert the submission: ${detail}`);
            }
            const after = await fetchSubmissionStatus(args.assignmentId, args.userId, opts);
            const afterSub = after.lastattempt?.submission ?? after.lastattempt?.teamsubmission;
            return {
                reverted: true,
                assignmentId: args.assignmentId,
                userId: args.userId,
                status: afterSub?.status ?? null,
                modifiedAt: isoTime(afterSub?.timemodified),
            };
        },
    }),
};
//# sourceMappingURL=grading.js.map