/**
 * Задания (mod_assign): список заданий курса, сдачи участников, одна сдача
 * целиком.
 */
import { z } from 'zod';
import { WS } from '../api/functions.js';
import { getMoodleClient } from '../api/moodle-client.js';
import { describeGradeType, htmlToText, isoTime, parseGrade } from '../utils/format.js';
import { log } from '../utils/logger.js';
import { assignmentIdSchema, courseIdSchema, userIdSchema } from '../utils/schemas.js';
import { defineTool, reqOpts } from './types.js';
// --- Общие помощники -----------------------------------------------------
/** Включённые типы сдачи: `onlinetext`, `file`, … (configs `<plugin>/enabled = 1`). */
function enabledPlugins(configs, subtype) {
    return configs
        .filter((c) => c.subtype === subtype && c.name === 'enabled' && c.value === '1')
        .map((c) => c.plugin);
}
/** Ссылка на файл без токена: Moodle её не добавляет, но подстраховываемся. */
function cleanFileUrl(fileUrl) {
    try {
        const url = new URL(fileUrl);
        url.searchParams.delete('token');
        url.searchParams.delete('wstoken');
        return url.toString();
    }
    catch {
        return fileUrl;
    }
}
function compactFiles(plugins, excludeAreas = []) {
    return (plugins ?? []).flatMap((p) => (p.fileareas ?? [])
        .filter((fa) => !excludeAreas.includes(fa.area))
        .flatMap((fa) => (fa.files ?? []).map((f) => ({
        name: f.filename,
        path: f.filepath && f.filepath !== '/' ? f.filepath : undefined,
        size: f.filesize ?? null,
        mimeType: f.mimetype ?? null,
        modifiedAt: isoTime(f.timemodified),
        url: cleanFileUrl(f.fileurl),
    }))));
}
function editorText(plugins, type) {
    const field = plugins?.find((p) => p.type === type)?.editorfields?.[0];
    if (!field)
        return null;
    const text = htmlToText(field.text);
    return text === '' ? null : text;
}
/** Последняя попытка по каждому пользователю. */
function latestByUser(items) {
    const map = new Map();
    for (const item of items) {
        const prev = map.get(item.userid);
        if (!prev || item.attemptnumber >= prev.attemptnumber)
            map.set(item.userid, item);
    }
    return map;
}
export function fetchSubmissionStatus(assignmentId, userId, options) {
    return getMoodleClient().call(WS.submissionStatus, { assignid: assignmentId, userid: userId }, options);
}
/**
 * Где живут комментарии к сдаче: контекст модуля курса (cmid) и сама сдача
 * (id записи сдачи, у групповой — сдачи группы).
 */
export async function submissionCommentArea(assignmentId, submissionId, options) {
    const { cm } = await getMoodleClient().call(WS.moduleByInstance, { module: 'assign', instance: assignmentId }, options);
    return {
        contextlevel: 'module',
        instanceid: cm.id,
        component: 'assignsubmission_comments',
        area: 'submission_comments',
        itemid: submissionId,
    };
}
export function compactComment(c) {
    return {
        id: c.id,
        userId: c.userid,
        author: c.fullname,
        createdAt: isoTime(c.timecreated),
        text: htmlToText(c.content),
    };
}
/** Предохранитель от бесконечного листания, если Moodle не отдал count. */
const MAX_COMMENT_PAGES = 20;
async function fetchSubmissionComments(assignmentId, submissionId, options) {
    const area = await submissionCommentArea(assignmentId, submissionId, options);
    const comments = [];
    for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
        const resp = await getMoodleClient().call(WS.comments, { ...area, page, sortdirection: 'ASC' }, options);
        comments.push(...resp.comments);
        if (resp.comments.length === 0 || comments.length >= (resp.count ?? comments.length))
            break;
    }
    return comments.map(compactComment);
}
// --- Тулы ----------------------------------------------------------------
const SUBMISSION_FILTERS = [
    'all',
    'submitted',
    'needs_grading',
    'graded',
    'not_submitted',
    'draft',
];
export const assignmentsTools = {
    moodle_list_assignments: defineTool({
        description: 'Assignments of a course (Assignment activity, mod_assign): assignment id (needed by the other ' +
            'tools), cmid (the number from the mod/assign/view.php?id=… URL), name, allow submissions ' +
            'from / due / cut-off dates, grading (points with maximum or scale, grade to pass), ' +
            'submission types and assignment description.',
        annotations: { readOnlyHint: true, idempotentHint: true },
        inputSchema: z.object({ courseId: courseIdSchema }),
        async execute(args, signal) {
            const opts = reqOpts(signal);
            const client = getMoodleClient();
            const response = await client.call(WS.assignments, { courseids: [args.courseId] }, opts);
            const assignments = response.courses.find((c) => c.id === args.courseId)?.assignments ?? [];
            // Проходной балл живёт в элементе журнала оценок, а mod_assign_get_assignments
            // его не отдаёт. Берём из модуля курса; не вышло — поле просто null.
            const passGrades = await Promise.all(assignments.map(async (a) => {
                try {
                    const { cm } = await client.call(WS.courseModule, { cmid: a.cmid }, opts);
                    const pass = Number(cm.gradepass);
                    return Number.isFinite(pass) && pass > 0 ? pass : null;
                }
                catch (err) {
                    log('warning', `gradepass for cmid ${a.cmid} not received:`, err instanceof Error ? err.message : err);
                    return null;
                }
            }));
            return {
                courseId: args.courseId,
                items: assignments.map((a, i) => ({
                    id: a.id,
                    cmid: a.cmid,
                    name: a.name,
                    url: `${client.siteUrl}/mod/assign/view.php?id=${a.cmid}`,
                    opensAt: isoTime(a.allowsubmissionsfromdate),
                    dueAt: isoTime(a.duedate),
                    cutoffAt: isoTime(a.cutoffdate),
                    gradingDueAt: isoTime(a.gradingduedate),
                    grading: { ...describeGradeType(a.grade), passGrade: passGrades[i] ?? null },
                    submissionTypes: enabledPlugins(a.configs, 'assignsubmission'),
                    feedbackTypes: enabledPlugins(a.configs, 'assignfeedback'),
                    maxAttempts: a.maxattempts === -1 ? null : a.maxattempts,
                    teamSubmission: a.teamsubmission === 1,
                    markingWorkflow: a.markingworkflow === 1,
                    blindMarking: a.blindmarking === 1,
                    description: htmlToText(a.intro),
                    attachments: (a.introattachments ?? []).map((f) => ({
                        name: f.filename,
                        url: cleanFileUrl(f.fileurl),
                    })),
                })),
            };
        },
    }),
    moodle_list_submissions: defineTool({
        description: 'Assignment participants and their submission state: status (new: not submitted, draft: ' +
            'draft, submitted: submitted, reopened: new attempt opened), submission time, whether it ' +
            'needs grading, current grade. The status filter narrows the list; counts summarizes all ' +
            "participants. moodle_get_submission returns one participant's full submission.",
        annotations: { readOnlyHint: true, idempotentHint: true },
        inputSchema: z.object({
            assignmentId: assignmentIdSchema,
            status: z
                .enum(SUBMISSION_FILTERS)
                .default('all')
                .describe('Filter: all — everyone; submitted — submitted; needs_grading — submitted and awaiting ' +
                'grading; graded — has a grade; not_submitted — not submitted; draft — draft'),
        }),
        async execute(args, signal) {
            const opts = reqOpts(signal);
            const client = getMoodleClient();
            const [participants, submissions, grades] = await Promise.all([
                client.call(WS.listParticipants, { assignid: args.assignmentId, groupid: 0, filter: '' }, opts),
                client.call(WS.submissions, { assignmentids: [args.assignmentId] }, opts),
                client.call(WS.grades, { assignmentids: [args.assignmentId] }, opts),
            ]);
            const subByUser = latestByUser(submissions.assignments.find((a) => a.assignmentid === args.assignmentId)?.submissions ??
                []);
            const gradeByUser = latestByUser(grades.assignments.find((a) => a.assignmentid === args.assignmentId)?.grades ?? []);
            const rows = participants.map((p) => {
                const sub = subByUser.get(p.id);
                const grade = gradeByUser.get(p.id);
                const gradeValue = parseGrade(grade?.grade);
                const status = sub?.status || p.submissionstatus || 'new';
                return {
                    userId: p.id,
                    fullname: p.fullname,
                    status,
                    submittedAt: status === 'submitted' ? isoTime(sub?.timemodified) : null,
                    modifiedAt: isoTime(sub?.timemodified),
                    attempt: sub?.attemptnumber ?? 0,
                    needsGrading: p.requiregrading,
                    gradingStatus: sub?.gradingstatus ?? null,
                    grade: gradeValue,
                    gradedAt: gradeValue !== null ? isoTime(grade?.timemodified) : null,
                    extension: p.grantedextension,
                    ...(p.suspended ? { suspended: true } : {}),
                };
            });
            const matches = {
                all: () => true,
                submitted: (r) => r.status === 'submitted',
                needs_grading: (r) => r.needsGrading,
                graded: (r) => r.grade !== null,
                not_submitted: (r) => r.status !== 'submitted',
                draft: (r) => r.status === 'draft',
            };
            return {
                assignmentId: args.assignmentId,
                counts: {
                    participants: rows.length,
                    submitted: rows.filter(matches.submitted).length,
                    needsGrading: rows.filter(matches.needs_grading).length,
                    graded: rows.filter(matches.graded).length,
                },
                filter: args.status,
                items: rows.filter(matches[args.status]),
            };
        },
    }),
    moodle_get_submission: defineTool({
        description: 'Full submission of one participant: status and attempt number, time, online text ' +
            '(as plain text), attached files (name, size, url for moodle_download_file), ' +
            'current grade, teacher feedback and submission comments (the conversation between the ' +
            'student and teachers; null if comments are unavailable for the assignment).',
        annotations: { readOnlyHint: true, idempotentHint: true },
        inputSchema: z.object({ assignmentId: assignmentIdSchema, userId: userIdSchema }),
        async execute(args, signal) {
            const opts = reqOpts(signal);
            const client = getMoodleClient();
            const [status, participant] = await Promise.all([
                fetchSubmissionStatus(args.assignmentId, args.userId, opts),
                client.call(WS.participant, { assignid: args.assignmentId, userid: args.userId }, opts),
            ]);
            const last = status.lastattempt;
            const sub = last?.submission ?? last?.teamsubmission;
            const feedback = status.feedback;
            const gradeValue = parseGrade(feedback?.grade?.grade);
            // Комментарии к сдаче — отдельный плагин, его может не быть на сайте или
            // в задании. Тогда поле null, а сдача всё равно читается.
            let comments = [];
            if (sub) {
                try {
                    comments = await fetchSubmissionComments(args.assignmentId, sub.id, opts);
                }
                catch (err) {
                    log('warning', `submission comments for user ${args.userId} not received:`, err instanceof Error ? err.message : err);
                    comments = null;
                }
            }
            return {
                assignmentId: args.assignmentId,
                userId: args.userId,
                fullname: participant.fullname,
                status: sub?.status ?? 'new',
                attempt: sub?.attemptnumber ?? 0,
                previousAttempts: status.previousattempts?.length ?? 0,
                submittedAt: sub?.status === 'submitted' ? isoTime(sub.timemodified) : null,
                modifiedAt: isoTime(sub?.timemodified),
                gradingStatus: last?.gradingstatus ?? null,
                locked: last?.locked ?? false,
                extensionDueAt: isoTime(last?.extensionduedate),
                onlineText: editorText(sub?.plugins, 'onlinetext'),
                files: compactFiles(sub?.plugins),
                grade: {
                    value: gradeValue,
                    display: feedback?.gradefordisplay ? htmlToText(feedback.gradefordisplay) : null,
                    gradedAt: gradeValue !== null
                        ? isoTime(feedback?.gradeddate ?? feedback?.grade?.timemodified)
                        : null,
                },
                feedback: editorText(feedback?.plugins, 'comments'),
                feedbackFiles: compactFiles(feedback?.plugins),
                comments,
            };
        },
    }),
};
//# sourceMappingURL=assignments.js.map