/**
 * Moodle Tools — barrel. Каждый экспорт-модуль описан категорией в
 * `scripts/tool-docs.mjs`; новый модуль без записи там роняет генератор.
 */

import { assignmentsTools } from './assignments.js';
import { filesTools } from './files.js';
import { gradingTools } from './grading.js';
import { siteTools } from './site.js';

export const allTools = {
  ...siteTools,
  ...assignmentsTools,
  ...filesTools,
  ...gradingTools,
} as const;

export { assignmentsTools, filesTools, gradingTools, siteTools };
