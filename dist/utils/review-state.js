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
];
/** Состояния, где ход за преподавателем. */
export const NEEDS_ATTENTION = [
    'new_submission',
    'resubmitted',
    'update_unreviewed',
    'student_comment',
];
/** Незакрытая работа: ход за преподавателем или ждём студента. */
export const OPEN = [...NEEDS_ATTENTION, 'awaiting_student', 'rework'];
function latest(times) {
    const valid = times.filter((t) => typeof t === 'number' && t > 0);
    return valid.length > 0 ? Math.max(...valid) : null;
}
export function reviewState(input) {
    const teacherCommentAt = latest(input.comments.filter((c) => c.byTeacher).map((c) => c.at));
    const studentCommentAt = latest(input.comments.filter((c) => !c.byTeacher).map((c) => c.at));
    const teacherAt = latest([teacherCommentAt, input.gradedAt, input.feedbackAt]);
    const modified = input.modifiedAt ?? 0;
    const base = (() => {
        switch (input.status) {
            case 'reopened':
                return 'rework';
            case 'draft':
                return teacherAt !== null ? 'rework' : 'not_submitted';
            case 'submitted':
                if (input.gradedAt !== null) {
                    if (modified <= input.gradedAt)
                        return 'graded';
                    return teacherCommentAt !== null && teacherCommentAt >= modified
                        ? 'update_reviewed'
                        : 'update_unreviewed';
                }
                if (teacherAt === null)
                    return 'new_submission';
                return teacherAt < modified ? 'resubmitted' : 'awaiting_student';
            default:
                return 'not_submitted';
        }
    })();
    // Студент написал после последней реакции преподавателя — на сдачу, где ход
    // был не за преподавателем. Новая работа и досылка и так требуют разбора.
    const quiet = [
        'graded',
        'update_reviewed',
        'awaiting_student',
        'rework',
        'not_submitted',
    ];
    if (quiet.includes(base) &&
        studentCommentAt !== null &&
        (teacherAt === null || studentCommentAt > teacherAt)) {
        return 'student_comment';
    }
    return base;
}
//# sourceMappingURL=review-state.js.map