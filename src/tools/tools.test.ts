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
import { FAKE_SITE, FAKE_TOKEN, fakeClient, stubMoodle, UPLOAD } from '../testing/fake-moodle.js';
import { composeFeedback, MAX_FEEDBACK_IMAGE_BYTES } from '../utils/feedback-images.js';
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
    expect(result.uploadFiles).toBeNull();
  });

  it('говорит, разрешает ли сервис токена загрузку файлов', async () => {
    stubMoodle({
      core_webservice_get_site_info: () => ({
        ...SITE_INFO,
        uploadfiles: 1,
        usermaxuploadfilesize: 1024,
      }),
    });
    const result = await siteTools.moodle_site_info.execute({});
    expect(result).toMatchObject({ uploadFiles: true, maxUploadBytes: 1024 });
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
  it('текст, файлы без токена, оценка, отзыв и комментарии', async () => {
    const calls = stubMoodle({
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
      core_course_get_course_module_by_instance: () => ({ cm: { id: 77, course: 10 } }),
      // Две страницы по одному комментарию: читаем, пока не наберём count.
      core_comment_get_comments: (p) => ({
        comments: [
          p.page === '0'
            ? {
                id: 1,
                content: '<p>Вопрос</p>',
                timecreated: 1_700_000_100,
                userid: 101,
                fullname: 'Студент А',
              }
            : {
                id: 2,
                content: '<p>Ответ</p>',
                timecreated: 1_700_000_200,
                userid: 2,
                fullname: 'Тест Преподаватель',
              },
        ],
        count: 2,
        perpage: 1,
      }),
    });

    const result = await assignmentsTools.moodle_get_submission.execute({
      assignmentId: 5,
      userId: 101,
    });

    const commentCalls = calls.filter((c) => c.wsfunction === 'core_comment_get_comments');
    expect(commentCalls[0]?.params).toEqual({
      contextlevel: 'module',
      instanceid: '77',
      component: 'assignsubmission_comments',
      area: 'submission_comments',
      itemid: '1',
      page: '0',
      sortdirection: 'ASC',
    });
    expect(result.comments).toEqual([
      expect.objectContaining({ id: 1, author: 'Студент А', text: 'Вопрос' }),
      expect.objectContaining({ id: 2, userId: 2, text: 'Ответ' }),
    ]);
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
      comments: [],
    });
  });

  it('комментарии недоступны — null, сдача читается', async () => {
    stubMoodle({
      mod_assign_get_submission_status: () => ({
        lastattempt: {
          submission: {
            id: 3,
            userid: 101,
            attemptnumber: 0,
            timecreated: 1,
            timemodified: 1,
            status: 'submitted',
          },
        },
      }),
      mod_assign_get_participant: () => ({ id: 101, fullname: 'Студент А' }),
      core_course_get_course_module_by_instance: () => ({ cm: { id: 77, course: 10 } }),
    });

    const result = await assignmentsTools.moodle_get_submission.execute({
      assignmentId: 5,
      userId: 101,
    });

    expect(result).toMatchObject({ status: 'submitted', comments: null });
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

  it('без отзыва или с пустым отзывом схема не пропускает вызов', () => {
    const schema = gradingTools.moodle_save_grade.inputSchema;
    const base = { assignmentId: 5, userId: 101, grade: 50 };
    expect(schema.safeParse(base).success).toBe(false);
    expect(schema.safeParse({ ...base, feedback: '  ' }).success).toBe(false);
    expect(schema.safeParse({ ...base, feedback: 'Хорошо' }).success).toBe(true);
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

describe('moodle_save_grade с картинками', () => {
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 5, 6, 7]);
  const DRAFT = 424242;
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'moodle-mcp-img-'));
    await writeFile(join(dir, 'shot-1.png'), PNG);
    await writeFile(join(dir, 'shot-2.jpg'), JPEG);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const base = {
    assignmentId: 5,
    userId: 101,
    grade: 80,
    attemptNumber: -1,
    addAttempt: false,
    applyToAll: true,
  };

  /** Загрузка отвечает как upload.php: запись файла с itemid черновика. */
  function storeUpload(_p: Record<string, string>, call: { file?: { name: string } }) {
    return [
      {
        component: 'user',
        filearea: 'draft',
        itemid: DRAFT,
        filename: call.file?.name,
        filepath: '/',
      },
    ];
  }

  function stubImages(
    extra: Record<string, (p: Record<string, string>, c: never) => unknown> = {},
  ) {
    return stubMoodle({
      core_course_get_course_module_by_instance: () => ({ cm: { id: 77, course: 10, grade: 100 } }),
      core_webservice_get_site_info: () => ({
        ...SITE_INFO,
        uploadfiles: 1,
        usermaxuploadfilesize: -1,
      }),
      [UPLOAD]: storeUpload,
      mod_assign_submit_grading_form: () => [],
      mod_assign_get_submission_status: () => ({
        feedback: {
          grade: { grade: '80.00000', timemodified: 1_700_000_000 },
          plugins: [
            {
              type: 'comments',
              editorfields: [
                {
                  name: 'comments',
                  format: 1,
                  text: `<p>Смотри</p><img src="${FAKE_SITE}/webservice/pluginfile.php/9/assignfeedback_comments/feedback/3/shot-1.png"><p><img src="${FAKE_SITE}/webservice/pluginfile.php/9/assignfeedback_comments/feedback/3/shot-2.jpg"></p>`,
                },
              ],
            },
          ],
        },
      }),
      ...extra,
    });
  }

  function formData(calls: { wsfunction: string; params: Record<string, string> }[]) {
    const submit = calls.find((c) => c.wsfunction === 'mod_assign_submit_grading_form');
    expect(submit).toBeDefined();
    expect(submit!.params.assignmentid).toBe('5');
    expect(submit!.params.userid).toBe('101');
    return new URLSearchParams(JSON.parse(submit!.params.jsonformdata!) as string);
  }

  it('грузит картинки в один черновик и шлёт его itemid в форме оценки', async () => {
    const calls = stubImages();

    const result = await gradingTools.moodle_save_grade.execute({
      ...base,
      feedback: '<p>Смотри</p><img src="@@PLUGINFILE@@/shot-1.png">',
      feedbackFormat: 'html',
      images: [
        { path: join(dir, 'shot-1.png') },
        { path: join(dir, 'shot-2.jpg'), alt: 'Форма "до"' },
      ],
    });

    const uploads = calls.filter((c) => c.wsfunction === UPLOAD);
    expect(uploads).toHaveLength(2);
    for (const u of uploads) {
      expect(u.url).toBe(`${FAKE_SITE}/webservice/upload.php`);
      expect(u.url).not.toContain(FAKE_TOKEN);
      expect(u.tokenInBody).toBe(true);
      expect(u.params).toMatchObject({ filearea: 'draft', filepath: '/' });
    }
    // Первый файл открывает черновик, второй ложится в тот же.
    expect(uploads.map((u) => u.params.itemid)).toEqual(['0', String(DRAFT)]);
    expect(uploads.map((u) => [u.file?.name, u.file?.type])).toEqual([
      ['shot-1.png', 'image/png'],
      ['shot-2.jpg', 'image/jpeg'],
    ]);
    expect(Array.from(uploads[0]!.file!.bytes)).toEqual(Array.from(PNG));

    const form = formData(calls);
    expect(form.get('assignfeedbackcomments_editor[itemid]')).toBe(String(DRAFT));
    expect(form.get('assignfeedbackcomments_editor[format]')).toBe('1');
    expect(form.get('assignfeedbackcomments_editor[text]')).toBe(
      '<p>Смотри</p><img src="@@PLUGINFILE@@/shot-1.png">' +
        '<p><img src="@@PLUGINFILE@@/shot-2.jpg" alt="Форма &quot;до&quot;"></p>',
    );
    expect(Object.fromEntries(form)).toMatchObject({
      grade: '80',
      attemptnumber: '-1',
      addattempt: '0',
      applytoall: '1',
      sendstudentnotifications: '1',
    });
    // Имена в @@PLUGINFILE@@ — ровно имена загруженных файлов.
    const referenced = [
      ...form.get('assignfeedbackcomments_editor[text]')!.matchAll(/@@PLUGINFILE@@\/([^"]+)/g),
    ].map((m) => m[1]);
    expect(referenced).toEqual(uploads.map((u) => u.file?.name));

    expect(calls.some((c) => c.wsfunction === 'mod_assign_save_grade')).toBe(false);
    // Загрузка — после проверки оценки, запись — после загрузки.
    const order = calls.map((c) => c.wsfunction);
    expect(order.indexOf('mod_assign_submit_grading_form')).toBeGreaterThan(
      order.lastIndexOf(UPLOAD),
    );
    expect(result.images).toEqual([
      { name: 'shot-1.png', inFeedback: true },
      { name: 'shot-2.jpg', inFeedback: true },
    ]);
  });

  it('ошибка загрузки: оценка не сохраняется, токен не попадает в текст ошибки', async () => {
    const calls = stubImages({
      [UPLOAD]: () => ({
        error: `Upload failed for token ${FAKE_TOKEN}`,
        errorcode: 'upload_error_ini_size',
      }),
    });

    const err = await gradingTools.moodle_save_grade
      .execute({
        ...base,
        feedback: 'См. снимок',
        feedbackFormat: 'plain',
        images: [{ path: join(dir, 'shot-1.png') }],
      })
      .then(
        () => null,
        (e: unknown) => e as Error,
      );

    expect(err).toBeInstanceOf(moodleClient.MoodleRequestError);
    expect(err?.message).toContain('upload_error_ini_size');
    expect(err?.message).not.toContain(FAKE_TOKEN);
    expect(calls.some((c) => c.wsfunction === 'mod_assign_submit_grading_form')).toBe(false);
    expect(calls.some((c) => c.wsfunction === 'mod_assign_save_grade')).toBe(false);
  });

  it('отказ по файлу и переименование файла сайтом — оценка не сохраняется', async () => {
    for (const reply of [
      () => [{ filename: 'shot-1.png', errortype: 'fileoversized', error: 'File too big' }],
      () => [{ filename: 'shot_1.png', itemid: DRAFT, filearea: 'draft' }],
    ]) {
      const calls = stubImages({ [UPLOAD]: reply });
      await expect(
        gradingTools.moodle_save_grade.execute({
          ...base,
          feedback: 'x',
          feedbackFormat: 'plain',
          images: [{ path: join(dir, 'shot-1.png') }],
        }),
      ).rejects.toThrow(/fileoversized|stored image/);
      expect(calls.some((c) => c.wsfunction === 'mod_assign_submit_grading_form')).toBe(false);
    }
  });

  it('сервис без загрузки файлов: отказ до первого файла', async () => {
    const calls = stubImages({
      core_webservice_get_site_info: () => ({ ...SITE_INFO, uploadfiles: 0 }),
    });
    await expect(
      gradingTools.moodle_save_grade.execute({
        ...base,
        feedback: 'x',
        feedbackFormat: 'plain',
        images: [{ path: join(dir, 'shot-1.png') }],
      }),
    ).rejects.toThrow(/does not allow file uploads/);
    expect(calls.some((c) => c.wsfunction === UPLOAD)).toBe(false);
  });

  it('предупреждение формы оценки — ошибка тула', async () => {
    stubImages({
      mod_assign_submit_grading_form: () => [
        { warningcode: 'couldnotsavegrade', message: 'Form validation failed.' },
      ],
    });
    await expect(
      gradingTools.moodle_save_grade.execute({
        ...base,
        feedback: 'x',
        feedbackFormat: 'plain',
        images: [{ path: join(dir, 'shot-1.png') }],
      }),
    ).rejects.toThrow(/Form validation failed/);
  });

  it('локальные проверки — до любого запроса в Moodle', async () => {
    await writeFile(join(dir, 'fake.png'), 'not a png');
    await writeFile(join(dir, 'big.png'), new Uint8Array(MAX_FEEDBACK_IMAGE_BYTES + 1));
    await writeFile(join(dir, 'снимок.png'), PNG);
    await writeFile(join(dir, 'notes.txt'), 'text');
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ images: [{ path: join(dir, 'fake.png') }] }, /does not match/],
      [{ images: [{ path: join(dir, 'big.png') }] }, /allowed 1…/],
      [{ images: [{ path: join(dir, 'снимок.png') }] }, /not allowed/],
      [{ images: [{ path: join(dir, 'notes.txt') }] }, /not a PNG/],
      [{ images: [{ path: join(dir, 'missing.png') }] }, /not a readable file/],
      [
        { images: [{ path: join(dir, 'shot-1.png') }, { path: join(dir, 'shot-1.png') }] },
        /unique/,
      ],
      [{ feedbackFormat: 'html', feedback: '<img src="@@PLUGINFILE@@/other.png">' }, /no image/],
    ];
    for (const [extra, error] of cases) {
      const calls = stubImages();
      await expect(
        gradingTools.moodle_save_grade.execute({
          ...base,
          feedback: 'x',
          feedbackFormat: 'plain',
          ...extra,
        } as Parameters<typeof gradingTools.moodle_save_grade.execute>[0]),
      ).rejects.toThrow(error);
      expect(calls).toHaveLength(0);
    }
  });

  it('схема: только абсолютные пути и не больше пяти картинок', () => {
    const schema = gradingTools.moodle_save_grade.inputSchema;
    const ok = { assignmentId: 5, userId: 101, grade: 50, feedback: 'x' };
    expect(schema.safeParse({ ...ok, images: [{ path: 'shot.png' }] }).success).toBe(false);
    const six = Array.from({ length: 6 }, (_, i) => ({ path: `/tmp/s${i}.png` }));
    expect(schema.safeParse({ ...ok, images: six }).success).toBe(false);
  });

  it('composeFeedback: markdown дописывает картинку, plain — всегда в конец', () => {
    const img = [{ name: 'a.png', alt: 'x [1]' }];
    expect(composeFeedback('Текст', 'markdown', img)).toEqual({
      text: 'Текст\n\n![x 1](@@PLUGINFILE@@/a.png)',
      format: 4,
    });
    expect(composeFeedback('![](@@PLUGINFILE@@/a.png)', 'markdown', img).text).toBe(
      '![](@@PLUGINFILE@@/a.png)',
    );
    expect(composeFeedback('a\n\nb', 'plain', img).text).toBe(
      '<p>a</p><p>b</p><p><img src="@@PLUGINFILE@@/a.png" alt="x [1]"></p>',
    );
  });
});

function submissionStatus(status: string) {
  return () => ({
    lastattempt: {
      submission: {
        id: 9,
        userid: 101,
        attemptnumber: 0,
        timecreated: 1,
        timemodified: 1_700_000_000,
        status,
      },
    },
  });
}

describe('moodle_add_submission_comment', () => {
  it('пишет комментарий в область сдачи и возвращает его', async () => {
    const calls = stubMoodle({
      mod_assign_get_submission_status: submissionStatus('submitted'),
      core_course_get_course_module_by_instance: () => ({ cm: { id: 77, course: 10 } }),
      core_comment_add_comments: () => [
        {
          id: 5,
          content: '<p>Поправьте тесты</p>',
          timecreated: 1_700_000_300,
          userid: 2,
          fullname: 'Тест Преподаватель',
        },
      ],
    });

    const result = await gradingTools.moodle_add_submission_comment.execute({
      assignmentId: 5,
      userId: 101,
      text: 'Поправьте тесты',
    });

    const add = calls.find((c) => c.wsfunction === 'core_comment_add_comments');
    expect(add?.params).toEqual({
      'comments[0][contextlevel]': 'module',
      'comments[0][instanceid]': '77',
      'comments[0][component]': 'assignsubmission_comments',
      'comments[0][area]': 'submission_comments',
      'comments[0][itemid]': '9',
      'comments[0][content]': 'Поправьте тесты',
    });
    expect(result).toMatchObject({ added: true, comment: { id: 5, text: 'Поправьте тесты' } });
  });

  it('нет сдачи — отказ без записи', async () => {
    const calls = stubMoodle({
      mod_assign_get_submission_status: () => ({ lastattempt: {} }),
    });

    await expect(
      gradingTools.moodle_add_submission_comment.execute({
        assignmentId: 5,
        userId: 101,
        text: 'x',
      }),
    ).rejects.toThrow(/no submission/);
    expect(calls.some((c) => c.wsfunction === 'core_comment_add_comments')).toBe(false);
  });
});

describe('moodle_revert_submission_to_draft', () => {
  it('возвращает сданную работу в черновик и читает статус обратно', async () => {
    let status = 'submitted';
    const calls = stubMoodle({
      mod_assign_get_submission_status: () => submissionStatus(status)(),
      mod_assign_revert_submissions_to_draft: () => {
        status = 'draft';
        return [];
      },
    });

    const result = await gradingTools.moodle_revert_submission_to_draft.execute({
      assignmentId: 5,
      userId: 101,
    });

    const revert = calls.find((c) => c.wsfunction === 'mod_assign_revert_submissions_to_draft');
    expect(revert?.params).toEqual({ assignmentid: '5', 'userids[0]': '101' });
    expect(result).toMatchObject({ reverted: true, status: 'draft' });
  });

  it('не сдано — отказ без записи', async () => {
    const calls = stubMoodle({ mod_assign_get_submission_status: submissionStatus('draft') });

    await expect(
      gradingTools.moodle_revert_submission_to_draft.execute({ assignmentId: 5, userId: 101 }),
    ).rejects.toThrow(/not submitted/);
    expect(calls.some((c) => c.wsfunction === 'mod_assign_revert_submissions_to_draft')).toBe(
      false,
    );
  });

  it('предупреждение Moodle — ошибка', async () => {
    stubMoodle({
      mod_assign_get_submission_status: submissionStatus('submitted'),
      mod_assign_revert_submissions_to_draft: () => [
        { item: 'assignment', itemid: 5, warningcode: 'couldnotrevert', message: 'User id: 101' },
      ],
    });

    await expect(
      gradingTools.moodle_revert_submission_to_draft.execute({ assignmentId: 5, userId: 101 }),
    ).rejects.toThrow(/did not revert/);
  });
});
