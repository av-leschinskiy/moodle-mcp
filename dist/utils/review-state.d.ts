/**
 * Состояние разбора сдачи: что сейчас нужно от преподавателя. Чистая функция
 * над временами сдачи, оценки и комментариев; модель, крайние случаи и почему
 * так — атом docs/features/review-state.md.
 */
export declare const REVIEW_STATES: readonly ['new_submission', 'resubmitted', 'update_unreviewed', 'student_comment', 'awaiting_student', 'rework', 'update_reviewed', 'graded', 'not_submitted'];
export type ReviewState = (typeof REVIEW_STATES)[number];
/** Состояния, где ход за преподавателем. */
export declare const NEEDS_ATTENTION: readonly ReviewState[];
/** Незакрытая работа: ход за преподавателем или ждём студента. */
export declare const OPEN: readonly ReviewState[];
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
    comments: {
        at: number;
        byTeacher: boolean;
    }[];
}
export declare function reviewState(input: ReviewInput): ReviewState;
//# sourceMappingURL=review-state.d.ts.map