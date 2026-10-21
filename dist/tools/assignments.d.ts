/**
 * Задания (mod_assign): список заданий курса, сдачи участников, одна сдача
 * целиком.
 */
import { z } from 'zod';
import type { CallOptions } from '../api/moodle-client.js';
interface MoodleFile {
    filename: string;
    filepath?: string;
    filesize?: number;
    fileurl: string;
    mimetype?: string;
    timemodified?: number;
}
interface SubmissionPlugin {
    type: string;
    name?: string;
    fileareas?: {
        area: string;
        files?: MoodleFile[];
    }[];
    editorfields?: {
        name: string;
        text: string;
        format: number;
    }[];
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
        grade?: {
            grade: string;
            timemodified: number;
            grader: number;
            attemptnumber: number;
        } | null;
        gradefordisplay?: string;
        gradeddate?: number;
        plugins?: SubmissionPlugin[];
    };
    previousattempts?: {
        attemptnumber: number;
    }[];
}
export interface MoodleComment {
    id: number;
    content: string;
    timecreated: number;
    userid: number;
    fullname: string;
}
export declare function fetchSubmissionStatus(assignmentId: number, userId: number, options?: CallOptions): Promise<SubmissionStatusResponse>;
/**
 * Где живут комментарии к сдаче: контекст модуля курса (cmid) и сама сдача
 * (id записи сдачи, у групповой — сдачи группы).
 */
export declare function submissionCommentArea(assignmentId: number, submissionId: number, options?: CallOptions): Promise<{
    contextlevel: string;
    instanceid: number;
    component: string;
    area: string;
    itemid: number;
}>;
export declare function compactComment(c: MoodleComment): {
    id: number;
    userId: number;
    author: string;
    createdAt: string | null;
    text: string;
};
export declare const assignmentsTools: {
    moodle_list_assignments: import("./types.js").ToolDef<z.ZodObject<{
        courseId: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        courseId: number;
    }, {
        courseId: number;
    }>, z.ZodTypeAny, {
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
    moodle_list_submissions: import("./types.js").ToolDef<z.ZodObject<{
        assignmentId: z.ZodNumber;
        status: z.ZodDefault<z.ZodEnum<["all", "submitted", "needs_grading", "graded", "not_submitted", "draft"]>>;
    }, "strip", z.ZodTypeAny, {
        assignmentId: number;
        status: "all" | "draft" | "graded" | "needs_grading" | "not_submitted" | "submitted";
    }, {
        assignmentId: number;
        status?: "all" | "draft" | "graded" | "needs_grading" | "not_submitted" | "submitted" | undefined;
    }>, z.ZodTypeAny, {
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
    moodle_get_submission: import("./types.js").ToolDef<z.ZodObject<{
        assignmentId: z.ZodNumber;
        userId: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        assignmentId: number;
        userId: number;
    }, {
        assignmentId: number;
        userId: number;
    }>, z.ZodTypeAny, {
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
        comments: {
            id: number;
            userId: number;
            author: string;
            createdAt: string | null;
            text: string;
        }[] | null;
    }>;
};
export {};
//# sourceMappingURL=assignments.d.ts.map