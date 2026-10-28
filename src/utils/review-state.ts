/**
 * Состояние разбора сдачи: что сейчас нужно от преподавателя. Чистая функция
 * над временами сдачи, оценки и комментариев; модель, крайние случаи и почему
 * так — атом docs/features/review-state.md.
 */

export const REVIEW_STATES = [
  'new_submission',
  'resubmitted',
  'update_unreviewed',
  'student_comment',
  'awaiting_student',
  'rework',
  'update_reviewed',
  'graded',
  'not_submitted',
] as const;

export type ReviewState = (typeof REVIEW_STATES)[number];

/** Состояния, где ход за преподавателем. */
export const NEEDS_ATTENTION: readonly ReviewState[] = [
  'new_submission',
  'resubmitted',
  'update_unreviewed',
  'student_comment',
];

/** Незакрытая работа: ход за преподавателем или ждём студента. */
export const OPEN: readonly ReviewState[] = [...NEEDS_ATTENTION, 'awaiting_student', 'rework'];

export interface ReviewInput {
  /** Статус последней попытки: `new`, `draft`, `submitted`, `reopened`; нет записи — undefined. */
  status: string | undefined;
  /** Время последнего изменения сдачи студентом (unix, секунды). */
  modifiedAt: number | undefined;
  /** Оценка текущей попытки выставлена: время записи оценки. */
  gradedAt: number | null;
  /**
   * Время записей оценки без оценки: отзыв без балла у текущей попытки или
   * оценка прошлой попытки. Это реакция преподавателя, но не «проверена».
   */
  feedbackAt: number | null;
  /** Комментарии к сдаче: время и автор-преподаватель ли (не сам студент). */
  comments: { at: number; byTeacher: boolean }[];
}

function latest(times: (number | null | undefined)[]): number | null {
  const valid = times.filter((t): t is number => typeof t === 'number' && t > 0);
  return valid.length > 0 ? Math.max(...valid) : null;
}

export function reviewState(input: ReviewInput): ReviewState {
  const teacherCommentAt = latest(input.comments.filter((c) => c.byTeacher).map((c) => c.at));
  const studentCommentAt = latest(input.comments.filter((c) => !c.byTeacher).map((c) => c.at));
  const teacherAt = latest([teacherCommentAt, input.gradedAt, input.feedbackAt]);
  const modified = input.modifiedAt ?? 0;

  const base = ((): ReviewState => {
    switch (input.status) {
      case 'reopened':
        return 'rework';
      case 'draft':
        return teacherAt !== null ? 'rework' : 'not_submitted';
      case 'submitted':
        if (input.gradedAt !== null) {
          if (modified <= input.gradedAt) return 'graded';
          return teacherCommentAt !== null && teacherCommentAt >= modified
            ? 'update_reviewed'
            : 'update_unreviewed';
        }
        if (teacherAt === null) return 'new_submission';
        return teacherAt < modified ? 'resubmitted' : 'awaiting_student';
      default:
        return 'not_submitted';
    }
  })();

  // Студент написал после последней реакции преподавателя — на сдачу, где ход
  // был не за преподавателем. Новая работа и досылка и так требуют разбора.
  const quiet: ReviewState[] = [
    'graded',
    'update_reviewed',
    'awaiting_student',
    'rework',
    'not_submitted',
  ];
  if (
    quiet.includes(base) &&
    studentCommentAt !== null &&
    (teacherAt === null || studentCommentAt > teacherAt)
  ) {
    return 'student_comment';
  }
  return base;
}
