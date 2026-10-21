/**
 * Переиспользуемые входные схемы тулов. Описание параметра живёт здесь, а не
 * копией в каждом туле: модель видит одно и то же определение везде.
 */
import { z } from 'zod';
export const courseIdSchema = z
    .number()
    .int()
    .positive()
    .describe('Course id (from moodle_list_courses or the course/view.php?id=… URL)');
export const assignmentIdSchema = z
    .number()
    .int()
    .positive()
    .describe('Assignment id from moodle_list_assignments (the id field, NOT the cmid from the mod/assign/view.php?id=… URL)');
export const userIdSchema = z
    .number()
    .int()
    .positive()
    .describe('Participant id (userId from moodle_list_submissions)');
//# sourceMappingURL=schemas.js.map