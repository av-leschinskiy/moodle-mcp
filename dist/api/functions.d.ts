/**
 * Функции веб-сервиса Moodle, которые зовут тулы.
 *
 * Единственный список имён в коде: тулы берут имена отсюда, а
 * `moodle_site_info` сверяет его с функциями, которые открывает токен, —
 * так видно, каких прав не хватает, до первого падения тула.
 */
export declare const WS: {
    readonly siteInfo: 'core_webservice_get_site_info';
    readonly userCourses: 'core_enrol_get_users_courses';
    readonly moduleByInstance: 'core_course_get_course_module_by_instance';
    readonly courseModule: 'core_course_get_course_module';
    readonly assignments: 'mod_assign_get_assignments';
    readonly listParticipants: 'mod_assign_list_participants';
    readonly participant: 'mod_assign_get_participant';
    readonly submissions: 'mod_assign_get_submissions';
    readonly submissionStatus: 'mod_assign_get_submission_status';
    readonly grades: 'mod_assign_get_grades';
    readonly saveGrade: 'mod_assign_save_grade';
    readonly submitGradingForm: 'mod_assign_submit_grading_form';
    readonly revertToDraft: 'mod_assign_revert_submissions_to_draft';
    readonly comments: 'core_comment_get_comments';
    readonly addComments: 'core_comment_add_comments';
};
//# sourceMappingURL=functions.d.ts.map