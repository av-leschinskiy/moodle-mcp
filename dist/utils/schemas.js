/**
 * Переиспользуемые входные схемы тулов. Описание параметра живёт здесь, а не
 * копией в каждом туле: модель видит одно и то же определение везде.
 */
import { z } from 'zod';
export const courseIdSchema = z
    .number()
    .int()
    .positive()
    .describe('id курса (из moodle_list_courses или адреса course/view.php?id=…)');
export const assignmentIdSchema = z
    .number()
    .int()
    .positive()
    .describe('id задания из moodle_list_assignments (поле id, НЕ cmid из адреса mod/assign/view.php?id=…)');
export const userIdSchema = z
    .number()
    .int()
    .positive()
    .describe('id участника (userId из moodle_list_submissions)');
//# sourceMappingURL=schemas.js.map