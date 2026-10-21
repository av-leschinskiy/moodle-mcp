import { describe, expect, it } from 'vitest';
import {
  buildLaunchUrl,
  isLaunchRedirect,
  launchSignature,
  newPassport,
  parseLaunchRedirect,
} from './launch.js';

const SITE = 'https://moodle.example.org';
const PASSPORT = 'abc123';

function redirectFor(parts: string[]): string {
  return `moodlemobile://token=${Buffer.from(parts.join(':::')).toString('base64')}`;
}

describe('buildLaunchUrl', () => {
  it('собирает launch.php мобильного сервиса с passport и схемой', () => {
    const url = new URL(buildLaunchUrl(SITE, PASSPORT));
    expect(url.origin + url.pathname).toBe(`${SITE}/admin/tool/mobile/launch.php`);
    expect(url.searchParams.get('service')).toBe('moodle_mobile_app');
    expect(url.searchParams.get('passport')).toBe(PASSPORT);
    expect(url.searchParams.get('urlscheme')).toBe('moodlemobile');
  });

  it('passport каждый раз новый', () => {
    expect(newPassport()).not.toBe(newPassport());
  });
});

describe('parseLaunchRedirect', () => {
  const signature = launchSignature(SITE, PASSPORT);

  it('подпись — md5(site + passport)', () => {
    // md5('https://moodle.example.orgabc123'), посчитано md5sum независимо от кода.
    expect(signature).toBe('f188ab524e044092d2d637d2d191f66f');
  });

  it('разбирает signature:::token:::privatetoken', () => {
    expect(parseLaunchRedirect(redirectFor([signature, 'tok', 'priv']), SITE, PASSPORT)).toEqual({
      token: 'tok',
      privatetoken: 'priv',
    });
  });

  it('privatetoken необязателен', () => {
    expect(parseLaunchRedirect(redirectFor([signature, 'tok']), SITE, PASSPORT)).toEqual({
      token: 'tok',
    });
  });

  it('понимает процентно-закодированный паддинг base64', () => {
    const payload = Buffer.from(`${signature}:::tok12`).toString('base64');
    expect(payload).toContain('=');
    const encoded = `moodlemobile://token=${encodeURIComponent(payload)}`;
    expect(parseLaunchRedirect(encoded, SITE, PASSPORT).token).toBe('tok12');
  });

  it('чужая подпись отклоняется, токен в ошибку не попадает', () => {
    const wrong = launchSignature(SITE, 'other-passport');
    let message = '';
    try {
      parseLaunchRedirect(redirectFor([wrong, 'secret-token-value']), SITE, PASSPORT);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/signature mismatch/);
    expect(message).not.toContain('secret-token-value');
  });

  it('подпись зависит от точного адреса сайта', () => {
    expect(() =>
      parseLaunchRedirect(redirectFor([signature, 'tok']), `${SITE}/`, PASSPORT),
    ).toThrow(/signature mismatch/);
  });

  it('не тот формат — понятная ошибка', () => {
    expect(() => parseLaunchRedirect('moodlemobile://other', SITE, PASSPORT)).toThrow(
      /does not contain/,
    );
    expect(() => parseLaunchRedirect(redirectFor(['onlyone']), SITE, PASSPORT)).toThrow(
      /Cannot parse/,
    );
  });
});

describe('isLaunchRedirect', () => {
  it('узнаёт только схему мобильного приложения', () => {
    expect(isLaunchRedirect('moodlemobile://token=abc')).toBe(true);
    expect(isLaunchRedirect('https://moodle.example.org/')).toBe(false);
  });
});
