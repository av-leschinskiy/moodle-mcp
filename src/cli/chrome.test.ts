import { describe, expect, it } from 'vitest';
import { findChrome, parseDevToolsActivePort, urlsFromCdpEvent } from './chrome.js';

describe('findChrome', () => {
  it('явно заданный бинарь выигрывает', () => {
    expect(findChrome('/opt/my-chrome', '/usr/bin', () => false)).toBe('/opt/my-chrome');
  });

  it('ищет кандидатов по PATH в порядке предпочтения', () => {
    const present = new Set(['/b/chromium', '/a/google-chrome-stable']);
    expect(findChrome(undefined, '/a:/b', (p) => present.has(p))).toBe('/a/google-chrome-stable');
    expect(findChrome(undefined, '/b', (p) => present.has(p))).toBe('/b/chromium');
  });

  it('ничего не нашёл — подсказывает MOODLE_CHROME', () => {
    expect(() => findChrome(undefined, '/nowhere', () => false)).toThrow(/MOODLE_CHROME/);
  });
});

describe('parseDevToolsActivePort', () => {
  it('порт и путь браузера', () => {
    expect(parseDevToolsActivePort('41235\n/devtools/browser/abc-def\n')).toEqual({
      port: 41235,
      browserPath: '/devtools/browser/abc-def',
    });
  });

  it('недописанный файл — ошибка (ждём дальше)', () => {
    expect(() => parseDevToolsActivePort('41235')).toThrow();
    expect(() => parseDevToolsActivePort('')).toThrow();
  });
});

describe('urlsFromCdpEvent', () => {
  const redirect = 'moodlemobile://token=AAAA';

  it('находит редирект во всех трёх видах событий', () => {
    expect(
      urlsFromCdpEvent({
        method: 'Network.requestWillBeSent',
        params: { request: { url: redirect } },
      }),
    ).toEqual([redirect]);
    expect(
      urlsFromCdpEvent({
        method: 'Network.responseReceivedExtraInfo',
        params: { headers: { location: redirect } },
      }),
    ).toEqual([redirect]);
    expect(
      urlsFromCdpEvent({ method: 'Page.frameRequestedNavigation', params: { url: redirect } }),
    ).toEqual([redirect]);
  });

  it('прочие события игнорирует', () => {
    expect(urlsFromCdpEvent({ method: 'Network.loadingFinished', params: {} })).toEqual([]);
  });
});
