/**
 * Moodle Tools — barrel. Каждый экспорт-модуль описан категорией в
 * `scripts/tool-docs.mjs`; новый модуль без записи там роняет генератор.
 */
import { assignmentsTools } from './assignments.js';
import { filesTools } from './files.js';
import { gradingTools } from './grading.js';
import { siteTools } from './site.js';
export declare const allTools: {
    readonly moodle_list_assignments: import("./types.js").ToolDef<import("zod").ZodObject<{
        courseId: import("zod").ZodNumber;
    }, "strip", import("zod").ZodTypeAny, {
        courseId: number;
    }, {
        courseId: number;
    }>, import("zod").ZodTypeAny, {
        courseId: number;
        items: {
            id: number;
            cmid: number;
            name: string;
            url: string;
            opensAt: string | null;
            dueAt: string | null;
            cutoffAt: string | null;
            gradingDueAt: string | null;
            grading: {
                type: 'points';
                max: number;
                passGrade: number | null;
            } | {
                type: 'scale';
                scaleId: number;
                passGrade: number | null;
            } | {
                type: 'none';
                passGrade: number | null;
            };
            submissionTypes: string[];
            feedbackTypes: string[];
            maxAttempts: number | null;
            teamSubmission: boolean;
            markingWorkflow: boolean;
            blindMarking: boolean;
            description: string;
            attachments: {
                name: string;
                url: string;
            }[];
        }[];
    }>;
    readonly moodle_list_submissions: import("./types.js").ToolDef<import("zod").ZodObject<{
        assignmentId: import("zod").ZodNumber;
        status: import("zod").ZodDefault<import("zod").ZodEnum<["all", "submitted", "needs_grading", "graded", "not_submitted", "draft"]>>;
    }, "strip", import("zod").ZodTypeAny, {
        assignmentId: number;
        status: "all" | "draft" | "graded" | "needs_grading" | "not_submitted" | "submitted";
    }, {
        assignmentId: number;
        status?: "all" | "draft" | "graded" | "needs_grading" | "not_submitted" | "submitted" | undefined;
    }>, import("zod").ZodTypeAny, {
        assignmentId: number;
        counts: {
            participants: number;
            submitted: number;
            needsGrading: number;
            graded: number;
        };
        filter: "all" | "draft" | "graded" | "needs_grading" | "not_submitted" | "submitted";
        items: {
            userId: number;
            fullname: string;
            status: string;
            submittedAt: string | null;
            modifiedAt: string | null;
            attempt: number;
            needsGrading: boolean;
            gradingStatus: string | null;
            grade: number | null;
            gradedAt: string | null;
            extension: boolean;
            suspended?: boolean;
        }[];
    }>;
    readonly moodle_get_submission: import("./types.js").ToolDef<import("zod").ZodObject<{
        assignmentId: import("zod").ZodNumber;
        userId: import("zod").ZodNumber;
    }, "strip", import("zod").ZodTypeAny, {
        assignmentId: number;
        userId: number;
    }, {
        assignmentId: number;
        userId: number;
    }>, import("zod").ZodTypeAny, {
        assignmentId: number;
        userId: number;
        fullname: string;
        status: string;
        attempt: number;
        previousAttempts: number;
        submittedAt: string | null;
        modifiedAt: string | null;
        gradingStatus: string | null;
        locked: boolean;
        extensionDueAt: string | null;
        onlineText: string | null;
        files: {
            name: string;
            path: string | undefined;
            size: number | null;
            mimeType: string | null;
            modifiedAt: string | null;
            url: string;
        }[];
        grade: {
            value: number | null;
            display: string | null;
            gradedAt: string | null;
        };
        feedback: string | null;
        feedbackFiles: {
            name: string;
            path: string | undefined;
            size: number | null;
            mimeType: string | null;
            modifiedAt: string | null;
            url: string;
        }[];
    }>;
    readonly moodle_download_file: import("./types.js").ToolDef<import("zod").ZodObject<{
        fileUrl: import("zod").ZodString;
        destDir: import("zod").ZodEffects<import("zod").ZodString, string, string>;
    }, "strip", import("zod").ZodTypeAny, {
        fileUrl: string;
        destDir: string;
    }, {
        fileUrl: string;
        destDir: string;
    }>, import("zod").ZodTypeAny, {
        path: string;
        bytes: number;
        mimeType: string | null;
    }>;
    readonly moodle_save_grade: import("./types.js").ToolDef<import("zod").ZodObject<{
        assignmentId: import("zod").ZodNumber;
        userId: import("zod").ZodNumber;
        grade: import("zod").ZodNumber;
        feedback: import("zod").ZodOptional<import("zod").ZodString>;
        feedbackFormat: import("zod").ZodDefault<import("zod").ZodEnum<["plain", "markdown", "html"]>>;
        attemptNumber: import("zod").ZodDefault<import("zod").ZodNumber>;
        addAttempt: import("zod").ZodDefault<import("zod").ZodBoolean>;
        workflowState: import("zod").ZodOptional<import("zod").ZodString>;
        applyToAll: import("zod").ZodDefault<import("zod").ZodBoolean>;
    }, "strip", import("zod").ZodTypeAny, {
        assignmentId: number;
        userId: number;
        grade: number;
        feedback?: string | undefined;
        feedbackFormat: "html" | "markdown" | "plain";
        attemptNumber: number;
        addAttempt: boolean;
        workflowState?: string | undefined;
        applyToAll: boolean;
    }, {
        assignmentId: number;
        userId: number;
        grade: number;
        feedback?: string | undefined;
        feedbackFormat?: "html" | "markdown" | "plain" | undefined;
        attemptNumber?: number | undefined;
        addAttempt?: boolean | undefined;
        workflowState?: string | undefined;
        applyToAll?: boolean | undefined;
    }>, import("zod").ZodTypeAny, {
        saved: boolean;
        assignmentId: number;
        userId: number;
        grade: number | null;
        gradeDisplay: string | null;
        gradedAt: string | null;
        feedback: string | null;
    }>;
    readonly moodle_site_info: import("./types.js").ToolDef<import("zod").ZodObject<{}, "strip", import("zod").ZodTypeAny, {}, {}>, import("zod").ZodTypeAny, {
        site: {
            name: string;
            url: string;
            release: string | null;
            version: string | null;
        };
        user: {
            id: number;
            username: string | null;
            fullname: string | null;
        };
        server: {
            package: string;
            version: string;
        };
        missingFunctions: ("core_course_get_course_module" | "core_course_get_course_module_by_instance" | "core_enrol_get_users_courses" | "core_webservice_get_site_info" | "mod_assign_get_assignments" | "mod_assign_get_grades" | "mod_assign_get_participant" | "mod_assign_get_submission_status" | "mod_assign_get_submissions" | "mod_assign_list_participants" | "mod_assign_save_grade")[];
    }>;
    readonly moodle_list_courses: import("./types.js").ToolDef<import("zod").ZodObject<{}, "strip", import("zod").ZodTypeAny, {}, {}>, import("zod").ZodTypeAny, {
        items: {
            id: number;
            shortname: string;
            fullname: string;
            visible: boolean;
            startsAt: string | null;
            endsAt: string | null;
            lastAccessAt: string | null;
        }[];
    }>;
};
export { assignmentsTools, filesTools, gradingTools, siteTools };
//# sourceMappingURL=index.d.ts.map