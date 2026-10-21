import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfig } from '../config.js';
import { FAKE_SITE, FAKE_TOKEN, fakeClient, jsonResponse } from '../testing/fake-moodle.js';
import { encodeParams, MoodleClient, MoodleRequestError, scrub } from './moodle-client.js';

beforeEach(() => {
  process.env.MOODLE_URL = FAKE_SITE;
  resetConfig();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('encodeParams', () => {
  it('массивы и вложенные объекты разворачиваются в формат Moodle', () => {
    expect(
      encodeParams({
        assignmentids: [5, 6],
        plugindata: { assignfeedbackcomments_editor: { text: '<p>ok</p>', format: 1 } },
      }),
    ).toEqual([
      ['assignmentids[0]', '5'],
      ['assignmentids[1]', '6'],
      ['plugindata[assignfeedbackcomments_editor][text]', '<p>ok</p>'],
      ['plugindata[assignfeedbackcomments_editor][format]', '1'],
    ]);
  });

  it('булевы уходят как 1/0, undefined и null пропускаются', () => {
    expect(
      encodeParams({ addattempt: false, applytoall: true, skip: undefined, nul: null }),
    ).toEqual([
      ['addattempt', '0'],
      ['applytoall', '1'],
    ]);
  });

  it('массив объектов — индексы и ключи вперемешку', () => {
    expect(encodeParams({ options: [{ name: 'a', value: 1 }] })).toEqual([
      ['options[0][name]', 'a'],
      ['options[0][value]', '1'],
    ]);
  });
});

describe('scrub', () => {
  it('вычищает token, wstoken и privatetoken в URL и формах', () => {
    expect(scrub('https://x/pluginfile.php/1/a.txt?token=abc123&forcedownload=1')).toBe(
      'https://x/pluginfile.php/1/a.txt?token=***&forcedownload=1',
    );
    expect(scrub('wstoken=abc&wsfunction=f')).toBe('wstoken=***&wsfunction=f');
    expect(scrub('privatetoken=zzz')).toBe('privatetoken=***');
  });

  it('вычищает известное значение токена где угодно в тексте', () => {
    expect(scrub(`Invalid token ${FAKE_TOKEN} given`, FAKE_TOKEN)).toBe('Invalid token *** given');
  });

  it('не ломает экранирование в JSON', () => {
    const json = JSON.stringify({ text: 'link?token=abc"' });
    expect(() => {
      JSON.parse(scrub(json));
    }).not.toThrow();
  });
});

describe('MoodleClient.call', () => {
  it('шлёт POST на server.php с токеном, функцией и форматом json', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await fakeClient().call('core_webservice_get_site_info', { userid: 7 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${FAKE_SITE}/webservice/rest/server.php`);
    expect(init.method).toBe('POST');
    const body = new URLSearchParams(String(init.body));
    expect(body.get('wstoken')).toBe(FAKE_TOKEN);
    expect(body.get('wsfunction')).toBe('core_webservice_get_site_info');
    expect(body.get('moodlewsrestformat')).toBe('json');
    expect(body.get('userid')).toBe('7');
  });

  it('исключение Moodle при HTTP 200 становится ошибкой kind=moodle с errorcode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          exception: 'required_capability_exception',
          errorcode: 'nopermissions',
          message: 'Нет прав',
        }),
      ),
    );

    const err = await fakeClient()
      .call('mod_assign_get_grades')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(MoodleRequestError);
    expect(err).toMatchObject({
      kind: 'moodle',
      errorcode: 'nopermissions',
      wsfunction: 'mod_assign_get_grades',
    });
    expect((err as Error).message).toContain('Нет прав');
  });

  it('invalidtoken — kind=auth с подсказкой про логин, токен в тексте вычищен', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          exception: 'moodle_exception',
          errorcode: 'invalidtoken',
          message: `Invalid token ${FAKE_TOKEN}`,
        }),
      ),
    );

    const err = (await fakeClient()
      .call('core_webservice_get_site_info')
      .catch((e: unknown) => e)) as MoodleRequestError;

    expect(err.kind).toBe('auth');
    expect(err.message).toContain('moodle-mcp-login');
    expect(err.message).not.toContain(FAKE_TOKEN);
  });

  it('HTTP-ошибка — kind=http, тело вычищено от токена', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(`bad wstoken=${FAKE_TOKEN}`, { status: 404 })),
    );

    const err = (await fakeClient()
      .call('f')
      .catch((e: unknown) => e)) as MoodleRequestError;

    expect(err.kind).toBe('http');
    expect(err.statusCode).toBe(404);
    expect(err.message).not.toContain(FAKE_TOKEN);
  });

  it('не-JSON — kind=parse', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>maintenance</html>', { status: 200 })),
    );

    await expect(fakeClient().call('f')).rejects.toMatchObject({ kind: 'parse' });
  });

  it('сетевую ошибку чтения ретраит, текст ошибки без токена', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse({ ok: 1 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new MoodleClient({
      siteUrl: FAKE_SITE,
      getToken: async () => FAKE_TOKEN,
      retries: 1,
    });

    await expect(client.call('f')).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('мутацию не ретраит', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);
    const client = new MoodleClient({
      siteUrl: FAKE_SITE,
      getToken: async () => FAKE_TOKEN,
      retries: 2,
    });

    await expect(
      client.call('mod_assign_save_grade', {}, { mutation: true }),
    ).rejects.toMatchObject({
      kind: 'network',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ошибка получения токена — kind=auth', async () => {
    const client = new MoodleClient({
      siteUrl: FAKE_SITE,
      getToken: async () => {
        throw new Error('Нет файла токена');
      },
    });

    await expect(client.call('f')).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('MoodleClient.normalizeFileUrl', () => {
  const client = fakeClient();

  it('ссылку интерфейса переписывает на webservice и убирает токен', () => {
    const url = client.normalizeFileUrl(
      `${FAKE_SITE}/pluginfile.php/12/assignsubmission_file/submission_files/3/a.zip?token=x`,
    );
    expect(url.toString()).toBe(
      `${FAKE_SITE}/webservice/pluginfile.php/12/assignsubmission_file/submission_files/3/a.zip`,
    );
  });

  it('ссылку веб-сервиса оставляет как есть', () => {
    const raw = `${FAKE_SITE}/webservice/pluginfile.php/12/x/y/0/a.txt`;
    expect(client.normalizeFileUrl(raw).toString()).toBe(raw);
  });

  it('чужой сайт и не-файловые адреса отклоняет — токен туда не уйдёт', () => {
    expect(() => client.normalizeFileUrl('https://evil.example.com/pluginfile.php/1/a')).toThrow(
      /не на/,
    );
    expect(() => client.normalizeFileUrl(`${FAKE_SITE}/login/index.php`)).toThrow(/pluginfile/);
    expect(() => client.normalizeFileUrl('not a url')).toThrow();
  });

  it('учитывает сайт в подкаталоге', () => {
    const sub = new MoodleClient({
      siteUrl: 'https://example.org/moodle',
      getToken: async () => 't',
    });
    expect(sub.normalizeFileUrl('https://example.org/moodle/pluginfile.php/1/a.txt').pathname).toBe(
      '/moodle/webservice/pluginfile.php/1/a.txt',
    );
    expect(() =>
      sub.normalizeFileUrl('https://example.org/other/pluginfile.php/1/a.txt'),
    ).toThrow();
  });
});

describe('MoodleClient.openFile', () => {
  it('добавляет токен в запрос, но не в возвращаемый URL', async () => {
    const fetchMock = vi.fn(
      async () => new Response('data', { headers: { 'Content-Type': 'text/plain' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { url, response } = await fakeClient().openFile(
      `${FAKE_SITE}/webservice/pluginfile.php/1/a.txt`,
    );

    const requested = (fetchMock.mock.calls[0] as unknown as [URL])[0];
    expect(requested.searchParams.get('token')).toBe(FAKE_TOKEN);
    expect(url.toString()).not.toContain(FAKE_TOKEN);
    expect(await response.text()).toBe('data');
  });

  it('JSON-исключение вместо файла становится ошибкой', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'x' }),
      ),
    );

    await expect(
      fakeClient().openFile(`${FAKE_SITE}/webservice/pluginfile.php/1/a.txt`),
    ).rejects.toMatchObject({
      kind: 'auth',
    });
  });
});
