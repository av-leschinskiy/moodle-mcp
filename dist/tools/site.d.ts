/**
 * Сайт и пользователь: кто я, какая версия Moodle, мои курсы.
 */
import { z } from 'zod';
import type { CallOptions } from '../api/moodle-client.js';
interface SiteInfoResponse {
    sitename: string;
    siteurl: string;
    release?: string;
    version?: string;
    userid: number;
    username?: string;
    fullname?: string;
    functions?: {
        name: string;
    }[];
}
export declare function fetchSiteInfo(options?: CallOptions): Promise<SiteInfoResponse>;
export declare const siteTools: {
    moodle_site_info: import("./types.js").ToolDef<z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>, z.ZodTypeAny, {
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
    moodle_list_courses: import("./types.js").ToolDef<z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>, z.ZodTypeAny, {
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
export {};
//# sourceMappingURL=site.d.ts.map