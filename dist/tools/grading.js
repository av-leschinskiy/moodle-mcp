/**
 * Действия проверяющего, которые видит студент: оценка и отзыв, комментарий
 * к сдаче, возврат сдачи на доработку. Поэтому у каждого тула
 * `destructiveHint` и подтверждение хоста.
 */
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import { WS } from '../api/functions.js';
import { encodeParams, getMoodleClient } from '../api/moodle-client.js';
import { composeFeedback, loadFeedbackImages, MAX_FEEDBACK_IMAGE_BYTES, MAX_FEEDBACK_IMAGES, } from '../utils/feedback-images.js';
import { describeGradeType, htmlToText, parseGrade, isoTime } from '../utils/format.js';
import { assignmentIdSchema, userIdSchema } from '../utils/schemas.js';
import { compactComment, fetchSubmissionStatus, submissionCommentArea, } from './assignments.js';
import { fetchSiteInfo } from './site.js';
import { defineTool, reqOpts } from './types.js';
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
/**
 * Загружает картинки в один черновик пользователя и возвращает его itemid.
 * Перед записью сверяется с сайтом: разрешает ли сервис токена загрузку и
 * не меньше ли предел пользователя, — чтобы отказ пришёл до первого файла.
 */
async function uploadImages(images, opts) {
    const info = await fetchSiteInfo(opts);
    if (info.uploadfiles === 0) {
        throw new Error("The token's web service does not allow file uploads (uploadfiles = 0): images cannot be " +
            'attached. Save the feedback without images.');
    }
    const limit = info.usermaxuploadfilesize;
    const tooBig = images.find((i) => limit !== undefined && limit >= 0 && i.data.byteLength > limit);
    if (tooBig) {
        throw new Error(`Image "${tooBig.name}" exceeds the site upload limit of ${limit} bytes.`);
    }
    const client = getMoodleClient();
    let itemid = 0;
    for (const image of images) {
        const stored = await client.uploadDraftFile({ name: image.name, mimeType: image.mimeType, data: image.data }, itemid, opts);
        // Имя в тексте должно совпасть с сохранённым, иначе картинка битая.
        if (stored.filename !== image.name) {
            throw new Error(`Moodle stored image "${image.name}" as "${stored.filename}"; the grade was not saved.`);
        }
        if (itemid !== 0 && stored.itemid !== itemid) {
            throw new Error('Moodle put images into different draft areas; the grade was not saved.');
        }
        itemid = stored.itemid;
    }
    return itemid;
}
export const gradingTools = {
    moodle_save_grade: defineTool({
        description: "Saves a participant's grade for an assignment and writes feedback comments. THE STUDENT " +
            'WILL SEE the grade and feedback (immediately, or after release if marking workflow is ' +
            'enabled) and may receive a notification. Call only after the teacher has explicitly ' +
            'confirmed the grade and the text. The grade is checked against the assignment maximum. ' +
            'Feedback is required: Moodle saves the grade and the feedback together, so the text ' +
            'replaces the previous feedback (and its images). images attaches local screenshots or ' +
            'pictures INSIDE the feedback text — THE STUDENT WILL SEE THEM: put them in the text as ' +
            '<img src="@@PLUGINFILE@@/<file name>"> (html) or ![](@@PLUGINFILE@@/<file name>) ' +
            '(markdown); images not referenced are appended at the end. Show the teacher the images ' +
            'before confirming.',
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
            images: z
                .array(z.object({
                path: z
                    .string()
                    .min(1)
                    .refine(isAbsolute, 'absolute path required')
                    .describe('Absolute path to a local PNG/JPEG/GIF/WebP file; the file name (Latin letters, digits, . _ -) is the name in @@PLUGINFILE@@'),
                alt: z.string().optional().describe('Alternative text of the image'),
            }))
                .max(MAX_FEEDBACK_IMAGES)
                .optional()
                .describe(`Images to show inside the feedback, up to ${MAX_FEEDBACK_IMAGES}, each up to ${MAX_FEEDBACK_IMAGE_BYTES / 1024 / 1024} MiB`),
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
            // Картинки и ссылки на них проверяются локально, до любого запроса.
            const images = await loadFeedbackImages(args.images ?? []);
            const comment = composeFeedback(args.feedback, args.feedbackFormat, images);
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
            if (images.length === 0) {
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
            }
            else {
                // mod_assign_save_grade принимает у редактора отзыва только text и
                // format: itemid черновика он отвергает, и файлы к отзыву не попадут.
                // Форма оценки (то же, что сохраняет панель оценивания) берёт
                // редактор целиком и переносит файлы черновика в область отзыва.
                // Ошибка загрузки обрывает вызов до записи оценки.
                const itemid = await uploadImages(images, opts);
                const form = new URLSearchParams(encodeParams({
                    grade: args.grade,
                    attemptnumber: args.attemptNumber,
                    addattempt: args.addAttempt,
                    workflowstate: args.workflowState,
                    applytoall: args.applyToAll,
                    // Как у mod_assign_save_grade: без поля Moodle уведомляет студента.
                    sendstudentnotifications: true,
                    [COMMENTS_EDITOR]: { ...comment, itemid },
                })).toString();
                const warnings = await client.call(WS.submitGradingForm, {
                    assignmentid: args.assignmentId,
                    userid: args.userId,
                    jsonformdata: JSON.stringify(form),
                }, { ...opts, mutation: true });
                if (warnings.length > 0) {
                    const detail = warnings.map((w) => w.message ?? w.warningcode).join('; ');
                    throw new Error(`Moodle did not save the grade: ${detail}`);
                }
            }
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
                // Картинка на месте, если в сохранённом тексте есть ссылка на её файл.
                images: images.map((i) => ({
                    name: i.name,
                    inFeedback: field?.text.includes(`/${i.name}`) ?? false,
                })),
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