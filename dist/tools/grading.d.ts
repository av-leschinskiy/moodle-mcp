/**
 * Действия проверяющего, которые видит студент: оценка и отзыв, комментарий
 * к сдаче, возврат сдачи на доработку. Поэтому у каждого тула
 * `destructiveHint` и подтверждение хоста.
 */
import { z } from 'zod';
/**
 * Проверка оценки по настройке задания до записи. Moodle сам выход за
 * максимум не отклоняет — значит, лишний ноль в оценке студент увидел бы.
 */
export declare function validateGrade(gradeSetting: number, grade: number): void;
export declare const gradingTools: {
    moodle_save_grade: import("./types.js").ToolDef<z.ZodObject<{
        assignmentId: z.ZodNumber;
        userId: z.ZodNumber;
        grade: z.ZodNumber;
        feedback: z.ZodString;
        feedbackFormat: z.ZodDefault<z.ZodEnum<["plain", "markdown", "html"]>>;
        images: z.ZodOptional<z.ZodArray<z.ZodObject<{
            path: z.ZodEffects<z.ZodString, string, string>;
            alt: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            path: string;
            alt?: string | undefined;
        }, {
            path: string;
            alt?: string | undefined;
        }>, "many">>;
        attemptNumber: z.ZodDefault<z.ZodNumber>;
        addAttempt: z.ZodDefault<z.ZodBoolean>;
        workflowState: z.ZodOptional<z.ZodString>;
        applyToAll: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        assignmentId: number;
        userId: number;
        grade: number;
        feedback: string;
        feedbackFormat: "html" | "markdown" | "plain";
        images?: {
            path: string;
            alt?: string | undefined;
        }[] | undefined;
        attemptNumber: number;
        addAttempt: boolean;
        workflowState?: string | undefined;
        applyToAll: boolean;
    }, {
        assignmentId: number;
        userId: number;
        grade: number;
        feedback: string;
        feedbackFormat?: "html" | "markdown" | "plain" | undefined;
        images?: {
            path: string;
            alt?: string | undefined;
        }[] | undefined;
        attemptNumber?: number | undefined;
        addAttempt?: boolean | undefined;
        workflowState?: string | undefined;
        applyToAll?: boolean | undefined;
    }>, z.ZodTypeAny, {
        saved: boolean;
        assignmentId: number;
        userId: number;
        grade: number | null;
        gradeDisplay: string | null;
        gradedAt: string | null;
        feedback: string | null;
        images: {
            name: string;
            inFeedback: boolean;
        }[];
    }>;
    moodle_add_submission_comment: import("./types.js").ToolDef<z.ZodObject<{
        assignmentId: z.ZodNumber;
        userId: z.ZodNumber;
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        assignmentId: number;
        userId: number;
        text: string;
    }, {
        assignmentId: number;
        userId: number;
        text: string;
    }>, z.ZodTypeAny, {
        added: boolean;
        assignmentId: number;
        userId: number;
        comment: {
            id: number;
            userId: number;
            author: string;
            createdAt: string | null;
            text: string;
        } | null;
    }>;
    moodle_revert_submission_to_draft: import("./types.js").ToolDef<z.ZodObject<{
        assignmentId: z.ZodNumber;
        userId: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        assignmentId: number;
        userId: number;
    }, {
        assignmentId: number;
        userId: number;
    }>, z.ZodTypeAny, {
        reverted: boolean;
        assignmentId: number;
        userId: number;
        status: string | null;
        modifiedAt: string | null;
    }>;
};
//# sourceMappingURL=grading.d.ts.map