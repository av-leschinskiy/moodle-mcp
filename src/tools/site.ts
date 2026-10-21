/**
 * Сайт и пользователь: кто я, какая версия Moodle, мои курсы.
 */

import { z } from 'zod';
import { WS } from '../api/functions.js';
import { getMoodleClient } from '../api/moodle-client.js';
import type { CallOptions } from '../api/moodle-client.js';
import { isoTime } from '../utils/format.js';
import { PACKAGE_NAME, VERSION } from '../version.js';
import { defineTool, reqOpts } from './types.js';

interface SiteInfoResponse {
  sitename: string;
  siteurl: string;
  release?: string;
  version?: string;
  userid: number;
  username?: string;
  fullname?: string;
  functions?: { name: string }[];
}

interface UserCourse {
  id: number;
  shortname: string;
  fullname: string;
  visible?: number;
  startdate?: number;
  enddate?: number;
  lastaccess?: number | null;
  progress?: number | null;
  completed?: boolean;
}

export function fetchSiteInfo(options?: CallOptions): Promise<SiteInfoResponse> {
  return getMoodleClient().call<SiteInfoResponse>(WS.siteInfo, {}, options);
}

export const siteTools = {
  moodle_site_info: defineTool({
    description:
      'Кто я на сайте Moodle и что это за сайт: имя пользователя, его id, название и версия ' +
      'Moodle, версия этого MCP-сервера. missingFunctions — функции API, которых не ' +
      'открывает токен (тулы, которым они нужны, упадут). Начинать с него, если ' +
      'не ясно, работает ли подключение.',
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
      };
    },
  }),

  moodle_list_courses: defineTool({
    description:
      'Мои курсы на сайте Moodle (куда я записан, в т. ч. как преподаватель): id, ' +
      'короткое и полное название, даты, видимость. id курса нужен для ' +
      'moodle_list_assignments.',
    annotations: { readOnlyHint: true, idempotentHint: true },
    inputSchema: z.object({}),
    async execute(_args, signal) {
      const opts = reqOpts(signal);
      const { userid } = await fetchSiteInfo(opts);
      const courses = await getMoodleClient().call<UserCourse[]>(WS.userCourses, { userid }, opts);
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
