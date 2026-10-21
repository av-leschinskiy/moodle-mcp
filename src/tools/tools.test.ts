/**
 * Тулы на подставном Moodle: что уходит в API и во что сворачивается ответ.
 * Все данные синтетические.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as moodleClient from '../api/moodle-client.js';
import { resetConfig } from '../config.js';
import { FAKE_SITE, FAKE_TOKEN, fakeClient, stubMoodle } from '../testing/fake-moodle.js';
import { assignmentsTools } from './assignments.js';
import { filesTools, safeFileName } from './files.js';
import { gradingTools, validateGrade } from './grading.js';
import { siteTools } from './site.js';

beforeEach(() => {
  process.env.MOODLE_URL = FAKE_SITE;
  resetConfig();
  vi.spyOn(moodleClient, 'getMoodleClient').mockReturnValue(fakeClient());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const SITE_INFO = {
  sitename: 'Учебный сайт',
  siteurl: FAKE_SITE,
  release: '4.5 (Build: 20240101)',
  version: '2024100700',
  userid: 2,
  username: 'teacher',
  fullname: 'Тест Преподаватель',
  functions: [{ name: 'core_webservice_get_site_info' }, { name: 'mod_assign_get_assignments' }],
};

describe('moodle_site_info', () => {
  it('кто я, версия и недостающие функции', async () => {
    stubMoodle({ core_webservice_get_site_info: () => SITE_INFO });

    const result = await siteTools.moodle_site_info.execute({});

    expect(result.user).toEqual({ id: 2, username: 'teacher', fullname: 'Тест Преподаватель' });
    expect(result.site.release).toContain('4.5');
    expect(result.missingFunctions).toContain('mod_assign_save_grade');
    expect(result.missingFunctions).not.toContain('mod_assign_get_assignments');
  });
});

describe('moodle_list_courses', () => {
  it('берёт userid из site_info и сворачивает курсы', async () => {
    const calls = stubMoodle({
      core_webservice_get_site_info: () => SITE_INFO,
      core_enrol_get_users_courses: () => [
        {
          id: 10,
          shortname: 'C1',
          fullname: 'Курс 1',
          visible: 1,
          startdate: 1_700_000_000,
          enddate: 0,
          summary: 'длинно',
        },
      ],
    });

    const result = await siteTools.moodle_list_courses.execute({});

    expect(calls.find((c) => c.wsfunction === 'core_enrol_get_users_courses')?.params).toEqual({
      userid: '2',
    });
    expect(result.items).toEqual([
      {
        id: 10,
        shortname: 'C1',
        fullname: 'Курс 1',
        visible: true,
        startsAt: '2023-11-14T22:13:20.000Z',
        endsAt: null,
        lastAccessAt: null,
      },
    ]);
  });
});

describe('moodle_list_assignments', () => {
  it('задания курса с cmid, оцениванием, проходным баллом и текстом', async () => {
    const calls = stubMoodle({
      mod_assign_get_assignments: () => ({
        courses: [
          {
            id: 10,
            assignments: [
              {
                id: 5,
                cmid: 77,
                course: 10,
                name: 'Задание 1',
                duedate: 1_700_000_000,
                allowsubmissionsfromdate: 0,
                cutoffdate: 0,
                gradingduedate: 0,
                grade: 100,
                teamsubmission: 0,
                blindmarking: 0,
                markingworkflow: 0,
                maxattempts: -1,
                configs: [
                  {
                    plugin: 'onlinetext',
                    subtype: 'assignsubmission',
                    name: 'enabled',
                    value: '1',
                  },
                  { plugin: 'file', subtype: 'assignsubmission', name: 'enabled', value: '0' },
                  { plugin: 'comments', subtype: 'assignfeedback', name: 'enabled', value: '1' },
                ],
                intro: '<p>Сделайте <b>отчёт</b></p>',
                introattachments: [],
              },
            ],
          },
        ],
      }),
      core_course_get_course_module: () => ({
        cm: { id: 77, course: 10, instance: 5, gradepass: '60.00000' },
      }),
    });

    const result = await assignmentsTools.moodle_list_assignments.execute({ courseId: 10 });

    expect(calls[0]?.params).toEqual({ 'courseids[0]': '10' });
    expect(result.items[0]).toMatchObject({
      id: 5,
      cmid: 77,
      url: `${FAKE_SITE}/mod/assign/view.php?id=77`,
      dueAt: '2023-11-14T22:13:20.000Z',
      opensAt: null,
      grading: { type: 'points', max: 100, passGrade: 60 },
      submissionTypes: ['onlinetext'],
      feedbackTypes: ['comments'],
      maxAttempts: null,
      description: 'Сделайте отчёт',
    });
  });

  it('проходной балл не получен — null, а не падение', async () => {
    stubMoodle({
      mod_assign_get_assignments: () => ({
        courses: [
          {
            id: 10,
            assignments: [
              {
                id: 5,
                cmid: 77,
                course: 10,
                name: 'A',
                duedate: 0,
                allowsubmissionsfromdate: 0,
                cutoffdate: 0,
                gradingduedate: 0,
                grade: -4,
                teamsubmission: 0,
                blindmarking: 0,
                markingworkflow: 0,
                maxattempts: 3,
                configs: [],
              },
            ],
          },
        ],
      }),
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await assignmentsTools.moodle_list_assignments.execute({ courseId: 10 });

    expect(result.items[0]?.grading).toEqual({ type: 'scale', scaleId: 4, passGrade: null });
  });
});

describe('moodle_list_submissions', () => {
  function stubSubmissions() {
    return stubMoodle({
      mod_assign_list_participants: () => [
        {
          id: 101,
          fullname: 'Студент А',
          email: 'a@example.org',
          submitted: true,
          requiregrading: true,
          grantedextension: false,
          submissionstatus: 'submitted',
        },
        {
          id: 102,
          fullname: 'Студент Б',
          submitted: true,
          requiregrading: false,
          grantedextension: false,
          submissionstatus: 'submitted',
        },
        {
          id: 103,
          fullname: 'Студент В',
          submitted: false,
          requiregrading: false,
          grantedextension: true,
          submissionstatus: '',
        },
      ],
      mod_assign_get_submissions: () => ({
        assignments: [
          {
            assignmentid: 5,
            submissions: [
              {
                id: 1,
                userid: 101,
                attemptnumber: 0,
                timecreated: 1,
                timemodified: 1_700_000_000,
                status: 'submitted',
                gradingstatus: 'notgraded',
              },
              {
                id: 2,
                userid: 102,
                attemptnumber: 0,
                timecreated: 1,
                timemodified: 1_700_000_100,
                status: 'submitted',
                gradingstatus: 'graded',
              },
            ],
          },
        ],
      }),
      mod_assign_get_grades: () => ({
        assignments: [
          {
            assignmentid: 5,
            grades: [
              {
                userid: 102,
                attemptnumber: 0,
                timemodified: 1_700_000_200,
                grader: 2,
                grade: '90.00000',
              },
            ],
          },
        ],
      }),
    });
  }

  it('сливает участников, сдачи и оценки; email наружу не уходит', async () => {
    const calls = stubSubmissions();

    const result = await assignmentsTools.moodle_list_submissions.execute({
      assignmentId: 5,
      status: 'all',
    });

    expect(
      calls.find((c) => c.wsfunction === 'mod_assign_list_participants')?.params,
    ).toMatchObject({ assignid: '5' });
    expect(result.counts).toEqual({ participants: 3, submitted: 2, needsGrading: 1, graded: 1 });
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({
      userId: 101,
      status: 'submitted',
      submittedAt: '2023-11-14T22:13:20.000Z',
      needsGrading: true,
      grade: null,
    });
    expect(result.items[1]).toMatchObject({ userId: 102, grade: 90, gradedAt: expect.any(String) });
    expect(result.items[2]).toMatchObject({
      userId: 103,
      status: 'new',
      submittedAt: null,
      extension: true,
    });
    expect(JSON.stringify(result)).not.toContain('@example.org');
  });

  it('фильтр сужает items, counts остаются по всем', async () => {
    stubSubmissions();

    const needs = await assignmentsTools.moodle_list_submissions.execute({
      assignmentId: 5,
      status: 'needs_grading',
    });
    const notSubmitted = await assignmentsTools.moodle_list_submissions.execute({
      assignmentId: 5,
      status: 'not_submitted',
    });

    expect(needs.items.map((i) => i.userId)).toEqual([101]);
    expect(needs.counts.participants).toBe(3);
    expect(notSubmitted.items.map((i) => i.userId)).toEqual([103]);
  });
});

describe('moodle_get_submission', () => {
  it('текст, файлы без токена, оценка и отзыв', async () => {
    stubMoodle({
      mod_assign_get_submission_status: () => ({
        lastattempt: {
          submission: {
            id: 1,
            userid: 101,
            attemptnumber: 1,
            timecreated: 1,
            timemodified: 1_700_000_000,
            status: 'submitted',
            plugins: [
              {
                type: 'onlinetext',
                editorfields: [{ name: 'onlinetext', text: '<p>Мой ответ</p>', format: 1 }],
                fileareas: [{ area: 'submissions_onlinetext', files: [] }],
              },
              {
                type: 'file',
                fileareas: [
                  {
                    area: 'submission_files',
                    files: [
                      {
                        filename: 'report.pdf',
                        filepath: '/',
                        filesize: 1234,
                        mimetype: 'application/pdf',
                        timemodified: 1_700_000_000,
                        fileurl: `${FAKE_SITE}/webservice/pluginfile.php/1/assignsubmission_file/submission_files/1/report.pdf?token=${FAKE_TOKEN}`,
                      },
                    ],
                  },
                ],
              },
            ],
          },
          gradingstatus: 'graded',
          locked: false,
        },
        feedback: {
          grade: { grade: '75.00000', timemodified: 1_700_000_500, grader: 2, attemptnumber: 1 },
          gradefordisplay: '75,00&nbsp;/&nbsp;100,00',
          gradeddate: 1_700_000_500,
          plugins: [
            {
              type: 'comments',
              editorfields: [{ name: 'comments', text: '<p>Хорошо</p>', format: 1 }],
            },
          ],
        },
        previousattempts: [{ attemptnumber: 0 }],
      }),
      mod_assign_get_participant: () => ({ id: 101, fullname: 'Студент А' }),
    });

    const result = await assignmentsTools.moodle_get_submission.execute({
      assignmentId: 5,
      userId: 101,
    });

    expect(result).toMatchObject({
      fullname: 'Студент А',
      status: 'submitted',
      attempt: 1,
      previousAttempts: 1,
      onlineText: 'Мой ответ',
      grade: { value: 75, display: '75,00 / 100,00' },
      feedback: 'Хорошо',
      gradingStatus: 'graded',
    });
    expect(result.files).toEqual([
      expect.objectContaining({ name: 'report.pdf', size: 1234, mimeType: 'application/pdf' }),
    ]);
    expect(result.files[0]?.url).not.toContain(FAKE_TOKEN);
    expect(result.files[0]?.url).not.toContain('token=');
  });

  it('нет сдачи — статус new и пустые поля', async () => {
    stubMoodle({
      mod_assign_get_submission_status: () => ({ lastattempt: { gradingstatus: 'notgraded' } }),
      mod_assign_get_participant: () => ({ id: 103, fullname: 'Студент В' }),
    });

    const result = await assignmentsTools.moodle_get_submission.execute({
      assignmentId: 5,
      userId: 103,
    });

    expect(result).toMatchObject({
      status: 'new',
      onlineText: null,
      files: [],
      feedback: null,
      grade: { value: null },
    });
  });
});

describe('moodle_download_file', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'moodle-mcp-dl-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('пишет файл в destDir и не затирает существующий', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('содержимое', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }),
      ),
    );
    await writeFile(join(dir, 'ответ.txt'), 'старое');

    const result = await filesTools.moodle_download_file.execute({
      fileUrl: `${FAKE_SITE}/webservice/pluginfile.php/1/assignsubmission_file/submission_files/1/%D0%BE%D1%82%D0%B2%D0%B5%D1%82.txt`,
      destDir: dir,
    });

    expect(result.path).toBe(join(dir, 'ответ (1).txt'));
    expect(await readFile(result.path, 'utf8')).toBe('содержимое');
    expect(await readFile(join(dir, 'ответ.txt'), 'utf8')).toBe('старое');
    expect(result.mimeType).toBe('text/plain');
  });

  it('имя файла не выводит за пределы каталога', () => {
    expect(safeFileName(new URL('https://x/pluginfile.php/1/..%2F..%2Fetc%2Fpasswd'))).toBe(
      '.._.._etc_passwd',
    );
    // URL сам схлопывает `..`: остаётся пустой сегмент.
    expect(safeFileName(new URL('https://x/pluginfile.php/1/..'))).toBe('file');
    expect(safeFileName(new URL('https://x/pluginfile.php/1/'))).toBe('file');
  });
});

describe('moodle_save_grade', () => {
  function stubGrading(extra: Record<string, (p: Record<string, string>) => unknown> = {}) {
    return stubMoodle({
      core_course_get_course_module_by_instance: () => ({ cm: { id: 77, course: 10, grade: 100 } }),
      mod_assign_save_grade: () => null,
      mod_assign_get_submission_status: () => ({
        feedback: {
          grade: { grade: '80.00000', timemodified: 1_700_000_000, grader: 2, attemptnumber: 0 },
          gradefordisplay: '80,00 / 100,00',
          plugins: [
            {
              type: 'comments',
              editorfields: [{ name: 'comments', text: '<p>Прежний отзыв</p>', format: 1 }],
            },
          ],
        },
      }),
      ...extra,
    });
  }

  it('шлёт оценку и отзыв в plugindata, plain → HTML', async () => {
    const calls = stubGrading();

    const result = await gradingTools.moodle_save_grade.execute({
      assignmentId: 5,
      userId: 101,
      grade: 80,
      feedback: 'Хорошо <ок>\n\nЕщё абзац',
      feedbackFormat: 'plain',
      attemptNumber: -1,
      addAttempt: false,
      applyToAll: true,
    });

    const save = calls.find((c) => c.wsfunction === 'mod_assign_save_grade');
    expect(save?.params).toEqual({
      assignmentid: '5',
      userid: '101',
      grade: '80',
      attemptnumber: '-1',
      addattempt: '0',
      workflowstate: '',
      applytoall: '1',
      'plugindata[assignfeedbackcomments_editor][text]': '<p>Хорошо &lt;ок&gt;</p><p>Ещё абзац</p>',
      'plugindata[assignfeedbackcomments_editor][format]': '1',
    });
    expect(result).toMatchObject({ saved: true, grade: 80 });
  });

  it('без feedback отправляет прежний отзыв без изменений', async () => {
    const calls = stubGrading();

    await gradingTools.moodle_save_grade.execute({
      assignmentId: 5,
      userId: 101,
      grade: 50,
      feedbackFormat: 'plain',
      attemptNumber: -1,
      addAttempt: false,
      applyToAll: true,
    });

    const save = calls.find((c) => c.wsfunction === 'mod_assign_save_grade');
    expect(save?.params['plugindata[assignfeedbackcomments_editor][text]']).toBe(
      '<p>Прежний отзыв</p>',
    );
  });

  it('оценка выше максимума не уходит в Moodle', async () => {
    const calls = stubGrading();

    await expect(
      gradingTools.moodle_save_grade.execute({
        assignmentId: 5,
        userId: 101,
        grade: 1000,
        feedback: 'x',
        feedbackFormat: 'plain',
        attemptNumber: -1,
        addAttempt: false,
        applyToAll: true,
      }),
    ).rejects.toThrow(/0…100/);
    expect(calls.some((c) => c.wsfunction === 'mod_assign_save_grade')).toBe(false);
  });

  it('validateGrade: шкала — целое от 1, без оценки — отказ', () => {
    expect(() => validateGrade(-3, 2)).not.toThrow();
    expect(() => validateGrade(-3, 1.5)).toThrow(/scale/);
    expect(() => validateGrade(0, 1)).toThrow(/has no grade/);
  });
});
