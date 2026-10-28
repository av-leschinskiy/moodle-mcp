/**
 * Задания (mod_assign): список заданий курса, сдачи участников, одна сдача
 * целиком.
 */

import { z } from 'zod';
import { WS } from '../api/functions.js';
import { getMoodleClient } from '../api/moodle-client.js';
import type { CallOptions } from '../api/moodle-client.js';
import { describeGradeType, htmlToText, isoTime, parseGrade } from '../utils/format.js';
import { log } from '../utils/logger.js';
import { NEEDS_ATTENTION, OPEN, reviewState } from '../utils/review-state.js';
import type { ReviewState } from '../utils/review-state.js';
import { assignmentIdSchema, courseIdSchema, userIdSchema } from '../utils/schemas.js';
import { defineTool, reqOpts } from './types.js';

// --- Формы ответов Moodle (только поля, на которые опирается код) ---------

interface AssignConfig {
  plugin: string;
  subtype: string;
  name: string;
  value: string;
}

interface MoodleFile {
  filename: string;
  filepath?: string;
  filesize?: number;
  fileurl: string;
  mimetype?: string;
  timemodified?: number;
}

interface Assignment {
  id: number;
  cmid: number;
  course: number;
  name: string;
  duedate: number;
  allowsubmissionsfromdate: number;
  cutoffdate: number;
  gradingduedate: number;
  grade: number;
  teamsubmission: number;
  blindmarking: number;
  markingworkflow: number;
  maxattempts: number;
  attemptreopenmethod?: string;
  configs: AssignConfig[];
  intro?: string;
  introattachments?: MoodleFile[];
}

interface AssignmentsResponse {
  courses: { id: number; assignments: Assignment[] }[];
}

interface CourseModuleResponse {
  cm: { id: number; course: number; instance: number; grade?: number; gradepass?: string | number };
}

interface Participant {
  id: number;
  fullname: string;
  submitted: boolean;
  requiregrading: boolean;
  grantedextension: boolean;
  submissionstatus?: string;
  suspended?: boolean;
}

interface SubmissionPlugin {
  type: string;
  name?: string;
  fileareas?: { area: string; files?: MoodleFile[] }[];
  editorfields?: { name: string; text: string; format: number }[];
}

interface Submission {
  id: number;
  userid: number;
  attemptnumber: number;
  timecreated: number;
  timemodified: number;
  status: string;
  gradingstatus?: string;
  plugins?: SubmissionPlugin[];
}

interface SubmissionsResponse {
  assignments: { assignmentid: number; submissions: Submission[] }[];
}

interface GradeRecord {
  userid: number;
  attemptnumber: number;
  timemodified: number;
  grader: number;
  grade: string;
}

interface GradesResponse {
  assignments: { assignmentid: number; grades: GradeRecord[] }[];
}

export interface SubmissionStatusResponse {
  lastattempt?: {
    submission?: Submission;
    teamsubmission?: Submission;
    locked?: boolean;
    graded?: boolean;
    gradingstatus?: string;
    extensionduedate?: number | null;
  };
  feedback?: {
    grade?: { grade: string; timemodified: number; grader: number; attemptnumber: number } | null;
    gradefordisplay?: string;
    gradeddate?: number;
    plugins?: SubmissionPlugin[];
  };
  previousattempts?: { attemptnumber: number }[];
}

interface ParticipantResponse {
  id: number;
  fullname: string;
}

interface ModuleByInstanceResponse {
  cm: { id: number };
}

export interface MoodleComment {
  id: number;
  content: string;
  timecreated: number;
  userid: number;
  fullname: string;
}

interface CommentsResponse {
  comments: MoodleComment[];
  count?: number;
}

// --- Общие помощники -----------------------------------------------------

/** Включённые типы сдачи: `onlinetext`, `file`, … (configs `<plugin>/enabled = 1`). */
function enabledPlugins(configs: AssignConfig[], subtype: string): string[] {
  return configs
    .filter((c) => c.subtype === subtype && c.name === 'enabled' && c.value === '1')
    .map((c) => c.plugin);
}

/** Ссылка на файл без токена: Moodle её не добавляет, но подстраховываемся. */
function cleanFileUrl(fileUrl: string): string {
  try {
    const url = new URL(fileUrl);
    url.searchParams.delete('token');
    url.searchParams.delete('wstoken');
    return url.toString();
  } catch {
    return fileUrl;
  }
}

function compactFiles(plugins: SubmissionPlugin[] | undefined, excludeAreas: string[] = []) {
  return (plugins ?? []).flatMap((p) =>
    (p.fileareas ?? [])
      .filter((fa) => !excludeAreas.includes(fa.area))
      .flatMap((fa) =>
        (fa.files ?? []).map((f) => ({
          name: f.filename,
          path: f.filepath && f.filepath !== '/' ? f.filepath : undefined,
          size: f.filesize ?? null,
          mimeType: f.mimetype ?? null,
          modifiedAt: isoTime(f.timemodified),
          url: cleanFileUrl(f.fileurl),
        })),
      ),
  );
}

function editorText(plugins: SubmissionPlugin[] | undefined, type: string): string | null {
  const field = plugins?.find((p) => p.type === type)?.editorfields?.[0];
  if (!field) return null;
  const text = htmlToText(field.text);
  return text === '' ? null : text;
}

/** Последняя попытка по каждому пользователю. */
function latestByUser<T extends { userid: number; attemptnumber: number }>(
  items: T[],
): Map<number, T> {
  const map = new Map<number, T>();
  for (const item of items) {
    const prev = map.get(item.userid);
    if (!prev || item.attemptnumber >= prev.attemptnumber) map.set(item.userid, item);
  }
  return map;
}

export function fetchSubmissionStatus(
  assignmentId: number,
  userId: number,
  options?: CallOptions,
): Promise<SubmissionStatusResponse> {
  return getMoodleClient().call<SubmissionStatusResponse>(
    WS.submissionStatus,
    { assignid: assignmentId, userid: userId },
    options,
  );
}

/** Модуль курса (cmid) задания: в его контексте живут комментарии к сдачам. */
async function assignmentCmid(assignmentId: number, options?: CallOptions): Promise<number> {
  const { cm } = await getMoodleClient().call<ModuleByInstanceResponse>(
    WS.moduleByInstance,
    { module: 'assign', instance: assignmentId },
    options,
  );
  return cm.id;
}

function commentArea(cmid: number, submissionId: number) {
  return {
    contextlevel: 'module',
    instanceid: cmid,
    component: 'assignsubmission_comments',
    area: 'submission_comments',
    itemid: submissionId,
  };
}

/**
 * Где живут комментарии к сдаче: контекст модуля курса (cmid) и сама сдача
 * (id записи сдачи, у групповой — сдачи группы).
 */
export async function submissionCommentArea(
  assignmentId: number,
  submissionId: number,
  options?: CallOptions,
) {
  return commentArea(await assignmentCmid(assignmentId, options), submissionId);
}

export function compactComment(c: MoodleComment) {
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

async function fetchComments(
  cmid: number,
  submissionId: number,
  options?: CallOptions,
): Promise<MoodleComment[]> {
  const area = commentArea(cmid, submissionId);
  const comments: MoodleComment[] = [];
  for (let page = 0; page < MAX_COMMENT_PAGES; page++) {
    const resp = await getMoodleClient().call<CommentsResponse>(
      WS.comments,
      { ...area, page, sortdirection: 'ASC' },
      options,
    );
    comments.push(...resp.comments);
    if (resp.comments.length === 0 || comments.length >= (resp.count ?? comments.length)) break;
  }
  return comments;
}

async function fetchSubmissionComments(
  assignmentId: number,
  submissionId: number,
  options?: CallOptions,
) {
  const cmid = await assignmentCmid(assignmentId, options);
  return (await fetchComments(cmid, submissionId, options)).map(compactComment);
}

/** Сколько запросов комментариев идёт к сайту одновременно. */
const COMMENT_CONCURRENCY = 8;

/** `fn` по всем элементам, не больше `limit` вызовов одновременно; порядок сохраняется. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Участники задания со сдачей, оценкой и состоянием разбора. Комментарии
 * запрашиваются только у тех, у кого есть запись сдачи: без неё их нет, а
 * состояние «не сдана» от них не зависит.
 *
 * `cmid` передаёт тот, кто его уже знает (сводка по курсу), иначе он берётся
 * одним запросом на задание.
 */
async function collectSubmissionRows(
  assignmentId: number,
  cmid: number | undefined,
  options?: CallOptions,
) {
  const client = getMoodleClient();
  const [participants, submissions, grades] = await Promise.all([
    client.call<Participant[]>(
      WS.listParticipants,
      { assignid: assignmentId, groupid: 0, filter: '' },
      options,
    ),
    client.call<SubmissionsResponse>(WS.submissions, { assignmentids: [assignmentId] }, options),
    client.call<GradesResponse>(WS.grades, { assignmentids: [assignmentId] }, options),
  ]);

  const subByUser = latestByUser(
    submissions.assignments.find((a) => a.assignmentid === assignmentId)?.submissions ?? [],
  );
  const gradeByUser = latestByUser(
    grades.assignments.find((a) => a.assignmentid === assignmentId)?.grades ?? [],
  );

  const withComments = participants.filter((p) => {
    const status = subByUser.get(p.id)?.status;
    return status !== undefined && status !== 'new';
  });
  // Комментарии к сдаче — отдельный плагин: нет его или упал запрос — состояние
  // считается по временам сдачи и оценки, а строка помечается.
  let resolvedCmid = cmid;
  if (resolvedCmid === undefined && withComments.length > 0) {
    try {
      resolvedCmid = await assignmentCmid(assignmentId, options);
    } catch (err) {
      log(
        'warning',
        `course module of assignment ${assignmentId} not received:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  const commentsByUser = new Map<number, MoodleComment[] | null>();
  await mapLimit(withComments, COMMENT_CONCURRENCY, async (p) => {
    const sub = subByUser.get(p.id)!;
    if (resolvedCmid === undefined) {
      commentsByUser.set(p.id, null);
      return;
    }
    try {
      commentsByUser.set(p.id, await fetchComments(resolvedCmid, sub.id, options));
    } catch (err) {
      log(
        'warning',
        `submission comments for user ${p.id} not received:`,
        err instanceof Error ? err.message : err,
      );
      commentsByUser.set(p.id, null);
    }
  });

  return participants.map((p) => {
    const sub = subByUser.get(p.id);
    const grade = gradeByUser.get(p.id);
    const gradeValue = parseGrade(grade?.grade);
    const status = sub?.status || p.submissionstatus || 'new';

    // Оценка «проверена» — только у текущей попытки; оценка прошлой попытки и
    // отзыв без балла — реакция преподавателя, но не проверка этой сдачи.
    const currentGraded =
      grade !== undefined &&
      gradeValue !== null &&
      grade.attemptnumber === (sub?.attemptnumber ?? 0);
    const comments = commentsByUser.get(p.id);
    const marked = (comments ?? []).map((c) => ({
      at: c.timecreated,
      byTeacher: c.userid !== p.id,
    }));
    const lastAt = (byTeacher: boolean) =>
      isoTime(Math.max(0, ...marked.filter((c) => c.byTeacher === byTeacher).map((c) => c.at)));
    const review = reviewState({
      status: sub?.status ?? (p.submissionstatus || undefined),
      modifiedAt: sub?.timemodified,
      gradedAt: currentGraded ? grade.timemodified : null,
      feedbackAt: grade !== undefined && !currentGraded ? grade.timemodified : null,
      comments: marked,
    });

    return {
      userId: p.id,
      fullname: p.fullname,
      status,
      review,
      submittedAt: status === 'submitted' ? isoTime(sub?.timemodified) : null,
      modifiedAt: isoTime(sub?.timemodified),
      attempt: sub?.attemptnumber ?? 0,
      needsGrading: p.requiregrading,
      gradingStatus: sub?.gradingstatus ?? null,
      grade: gradeValue,
      gradedAt: gradeValue !== null ? isoTime(grade?.timemodified) : null,
      teacherCommentAt: lastAt(true),
      studentCommentAt: lastAt(false),
      extension: p.grantedextension,
      ...(p.suspended ? { suspended: true } : {}),
      ...(comments === null ? { commentsUnavailable: true } : {}),
    };
  });
}

type SubmissionRow = Awaited<ReturnType<typeof collectSubmissionRows>>[number];

// --- Тулы ----------------------------------------------------------------

const SUBMISSION_FILTERS = [
  'all',
  'submitted',
  'needs_grading',
  'graded',
  'not_submitted',
  'draft',
  'needs_attention',
  'open',
] as const;

type SubmissionFilter = (typeof SUBMISSION_FILTERS)[number];

const ROW_MATCHES: Record<SubmissionFilter, (r: SubmissionRow) => boolean> = {
  all: () => true,
  submitted: (r) => r.status === 'submitted',
  needs_grading: (r) => r.needsGrading,
  graded: (r) => r.grade !== null,
  not_submitted: (r) => r.status !== 'submitted',
  draft: (r) => r.status === 'draft',
  needs_attention: (r) => NEEDS_ATTENTION.includes(r.review),
  open: (r) => OPEN.includes(r.review),
};

/** Расшифровка состояний для описаний тулов: одна на оба тула. */
const REVIEW_STATES_HELP =
  'review is what the submission needs from the teacher, computed from the submission, grade ' +
  'and submission comment times (a teacher comment is one whose author is not the student): ' +
  'new_submission — submitted, no grade, no teacher reaction yet: review it; ' +
  'resubmitted — submitted again after a teacher comment or feedback (returned for rework or a ' +
  'previous attempt graded): review it again; ' +
  'update_unreviewed — changed after grading and no teacher comment since: review the update; ' +
  'student_comment — the student commented after the last teacher comment or grade on a ' +
  'submission otherwise waiting on nobody: read and answer; ' +
  'awaiting_student — submitted, no grade, a teacher commented after the submission: waiting ' +
  'for the student to answer or fix; ' +
  'rework — draft or reopened attempt after a teacher comment or feedback: waiting for the ' +
  'student; ' +
  'update_reviewed — changed after grading, a teacher commented after the change: nothing to do; ' +
  'graded — graded and not changed since: nothing to do; ' +
  'not_submitted — no submission or a draft the teacher has not reacted to: nothing to do. ' +
  'needs_attention = new_submission, resubmitted, update_unreviewed, student_comment; ' +
  'open = needs_attention plus awaiting_student and rework. teacherCommentAt / ' +
  'studentCommentAt — time of the last comment by a teacher / by the student; ' +
  'commentsUnavailable: true — comments could not be read, review relies on times only.';

const REVIEW_FILTERS = ['needs_attention', 'open'] as const;

export const assignmentsTools = {
  moodle_list_assignments: defineTool({
    description:
      'Assignments of a course (Assignment activity, mod_assign): assignment id (needed by the other ' +
      'tools), cmid (the number from the mod/assign/view.php?id=… URL), name, allow submissions ' +
      'from / due / cut-off dates, grading (points with maximum or scale, grade to pass), ' +
      'submission types and assignment description.',
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: z.object({ courseId: courseIdSchema }),
    async execute(args, signal) {
      const opts = reqOpts(signal);
      const client = getMoodleClient();
      const response = await client.call<AssignmentsResponse>(
        WS.assignments,
        { courseids: [args.courseId] },
        opts,
      );
      const assignments = response.courses.find((c) => c.id === args.courseId)?.assignments ?? [];

      // Проходной балл живёт в элементе журнала оценок, а mod_assign_get_assignments
      // его не отдаёт. Берём из модуля курса; не вышло — поле просто null.
      const passGrades = await Promise.all(
        assignments.map(async (a) => {
          try {
            const { cm } = await client.call<CourseModuleResponse>(
              WS.courseModule,
              { cmid: a.cmid },
              opts,
            );
            const pass = Number(cm.gradepass);
            return Number.isFinite(pass) && pass > 0 ? pass : null;
          } catch (err) {
            log(
              'warning',
              `gradepass for cmid ${a.cmid} not received:`,
              err instanceof Error ? err.message : err,
            );
            return null;
          }
        }),
      );

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
    description:
      'Assignment participants and their submission state: status (new: not submitted, draft: ' +
      'draft, submitted: submitted, reopened: new attempt opened), submission time, whether it ' +
      'needs grading by Moodle rules, current grade, and review. ' +
      REVIEW_STATES_HELP +
      ' The status filter narrows the list; counts summarizes all participants. ' +
      "moodle_get_submission returns one participant's full submission; " +
      'moodle_list_pending_submissions does the same review for a whole course.',
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: z.object({
      assignmentId: assignmentIdSchema,
      status: z
        .enum(SUBMISSION_FILTERS)
        .default('all')
        .describe(
          'Filter: all — everyone; submitted — submitted; needs_grading — submitted and awaiting ' +
            'grading by Moodle rules; graded — has a grade; not_submitted — not submitted; ' +
            'draft — draft; needs_attention — the teacher has to act (see review); open — ' +
            'needs_attention plus waiting for the student',
        ),
    }),
    async execute(args, signal) {
      const rows = await collectSubmissionRows(args.assignmentId, undefined, reqOpts(signal));
      return {
        assignmentId: args.assignmentId,
        counts: {
          participants: rows.length,
          submitted: rows.filter(ROW_MATCHES.submitted).length,
          needsGrading: rows.filter(ROW_MATCHES.needs_grading).length,
          graded: rows.filter(ROW_MATCHES.graded).length,
          needsAttention: rows.filter(ROW_MATCHES.needs_attention).length,
        },
        filter: args.status,
        items: rows.filter(ROW_MATCHES[args.status]),
      };
    },
  }),

  moodle_list_pending_submissions: defineTool({
    description:
      'Submissions across all assignments of a course that need the teacher (or, with ' +
      'status=open, are not finished yet), in one call: assignment, participant, Moodle status, ' +
      'review, submission / grade / last comment times. ' +
      REVIEW_STATES_HELP +
      ' counts gives the number of returned items per review state. Then moodle_get_submission ' +
      'for the submission itself and its comments.',
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: z.object({
      courseId: courseIdSchema,
      status: z
        .enum(REVIEW_FILTERS)
        .default('needs_attention')
        .describe(
          'needs_attention — the teacher has to act; open — also submissions waiting for the ' +
            'student (awaiting_student, rework)',
        ),
    }),
    async execute(args, signal) {
      const opts = reqOpts(signal);
      const response = await getMoodleClient().call<AssignmentsResponse>(
        WS.assignments,
        { courseids: [args.courseId] },
        opts,
      );
      const assignments = response.courses.find((c) => c.id === args.courseId)?.assignments ?? [];

      // Задания по очереди: внутри задания комментарии и так идут пачкой, а
      // параллель по заданиям умножила бы нагрузку на сайт.
      const items = [];
      for (const a of assignments) {
        const rows = await collectSubmissionRows(a.id, a.cmid, opts);
        for (const r of rows.filter(ROW_MATCHES[args.status])) {
          items.push({
            assignmentId: a.id,
            assignment: a.name,
            userId: r.userId,
            fullname: r.fullname,
            review: r.review,
            status: r.status,
            attempt: r.attempt,
            modifiedAt: r.modifiedAt,
            grade: r.grade,
            gradedAt: r.gradedAt,
            teacherCommentAt: r.teacherCommentAt,
            studentCommentAt: r.studentCommentAt,
            ...(r.suspended ? { suspended: true } : {}),
            ...(r.commentsUnavailable ? { commentsUnavailable: true } : {}),
          });
        }
      }

      const counts: Partial<Record<ReviewState, number>> = {};
      for (const i of items) counts[i.review] = (counts[i.review] ?? 0) + 1;
      return {
        courseId: args.courseId,
        assignments: assignments.length,
        filter: args.status,
        counts,
        items,
      };
    },
  }),

  moodle_get_submission: defineTool({
    description:
      'Full submission of one participant: status and attempt number, time, online text ' +
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
        client.call<ParticipantResponse>(
          WS.participant,
          { assignid: args.assignmentId, userid: args.userId },
          opts,
        ),
      ]);

      const last = status.lastattempt;
      const sub = last?.submission ?? last?.teamsubmission;
      const feedback = status.feedback;
      const gradeValue = parseGrade(feedback?.grade?.grade);

      // Комментарии к сдаче — отдельный плагин, его может не быть на сайте или
      // в задании. Тогда поле null, а сдача всё равно читается.
      let comments: ReturnType<typeof compactComment>[] | null = [];
      if (sub) {
        try {
          comments = await fetchSubmissionComments(args.assignmentId, sub.id, opts);
        } catch (err) {
          log(
            'warning',
            `submission comments for user ${args.userId} not received:`,
            err instanceof Error ? err.message : err,
          );
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
          gradedAt:
            gradeValue !== null
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
