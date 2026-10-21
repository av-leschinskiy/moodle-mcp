/**
 * Функции веб-сервиса Moodle, которые зовут тулы.
 *
 * Единственный список имён в коде: тулы берут имена отсюда, а
 * `moodle_site_info` сверяет его с функциями, которые открывает токен, —
 * так видно, каких прав не хватает, до первого падения тула.
 */
export const WS = {
  siteInfo: 'core_webservice_get_site_info',
  userCourses: 'core_enrol_get_users_courses',
  moduleByInstance: 'core_course_get_course_module_by_instance',
  courseModule: 'core_course_get_course_module',
  assignments: 'mod_assign_get_assignments',
  listParticipants: 'mod_assign_list_participants',
  participant: 'mod_assign_get_participant',
  submissions: 'mod_assign_get_submissions',
  submissionStatus: 'mod_assign_get_submission_status',
  grades: 'mod_assign_get_grades',
  saveGrade: 'mod_assign_save_grade',
} as const;
