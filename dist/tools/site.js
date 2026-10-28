/**
 * Сайт и пользователь: кто я, какая версия Moodle, мои курсы.
 */
import { z } from 'zod';
import { WS } from '../api/functions.js';
import { getMoodleClient } from '../api/moodle-client.js';
import { isoTime } from '../utils/format.js';
import { PACKAGE_NAME, VERSION } from '../version.js';
import { defineTool, reqOpts } from './types.js';
export function fetchSiteInfo(options) {
    return getMoodleClient().call(WS.siteInfo, {}, options);
}
export const siteTools = {
    moodle_site_info: defineTool({
        description: 'Who I am on the Moodle site and what the site is: user name and id, site name and ' +
            'Moodle version, version of this MCP server. missingFunctions lists API functions the ' +
            'token does not grant (tools that need them will fail). uploadFiles tells whether the ' +
            "token's service allows file uploads (needed for images in moodle_save_grade; null — " +
            'the site did not say). Start here if it is unclear whether the connection works.',
        annotations: { readOnlyHint: true, idempotentHint: true },
        inputSchema: z.object({}),
        async execute(_args, signal) {
            const info = await fetchSiteInfo(reqOpts(signal));
            const available = new Set((info.functions ?? []).map((f) => f.name));
            return {
                site: {
                    name: info.sitename,
                    url: info.siteurl,
                    release: info.release ?? null,
                    version: info.version ?? null,
                },
                user: { id: info.userid, username: info.username ?? null, fullname: info.fullname ?? null },
                server: { package: PACKAGE_NAME, version: VERSION },
                missingFunctions: Object.values(WS).filter((name) => !available.has(name)),
                uploadFiles: info.uploadfiles === undefined ? null : info.uploadfiles === 1,
                maxUploadBytes: info.usermaxuploadfilesize === undefined || info.usermaxuploadfilesize < 0
                    ? null
                    : info.usermaxuploadfilesize,
            };
        },
    }),
    moodle_list_courses: defineTool({
        description: 'My courses on the Moodle site (where I am enrolled, including as a teacher): id, ' +
            'short and full name, dates, visibility. The course id is needed for ' +
            'moodle_list_assignments.',
        annotations: { readOnlyHint: true, idempotentHint: true },
        inputSchema: z.object({}),
        async execute(_args, signal) {
            const opts = reqOpts(signal);
            const { userid } = await fetchSiteInfo(opts);
            const courses = await getMoodleClient().call(WS.userCourses, { userid }, opts);
            return {
                items: courses.map((c) => ({
                    id: c.id,
                    shortname: c.shortname,
                    fullname: c.fullname,
                    visible: c.visible !== 0,
                    startsAt: isoTime(c.startdate),
                    endsAt: isoTime(c.enddate),
                    lastAccessAt: isoTime(c.lastaccess),
                })),
            };
        },
    }),
};
//# sourceMappingURL=site.js.map