/**
 * Оценивание: запись оценки и отзыва. Единственная запись, которую видит
 * студент, — поэтому `destructiveHint` и подтверждение хоста.
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
    }>;
};
//# sourceMappingURL=grading.d.ts.map