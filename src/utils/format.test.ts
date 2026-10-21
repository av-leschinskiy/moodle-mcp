import { describe, expect, it } from 'vitest';
import { describeGradeType, htmlToText, isoTime, parseGrade, plainToHtml } from './format.js';

describe('htmlToText', () => {
  it('абзацы, переводы строк и списки сохраняются, теги уходят', () => {
    expect(
      htmlToText(
        '<p>Первый&nbsp;абзац</p><p>Второй<br>строка</p><ul><li>раз</li><li>два</li></ul>',
      ),
    ).toBe('Первый абзац\n\nВторой\nстрока\n\n- раз\n- два');
  });

  it('ссылка — текст и адрес в скобках', () => {
    expect(htmlToText('<a href="https://example.org/doc">документация</a>')).toBe(
      'документация (https://example.org/doc)',
    );
  });

  it('сущности раскодируются, script/style выбрасываются', () => {
    expect(htmlToText('<style>p{}</style>a &lt; b &amp;&amp; c &#8212; &#x41;')).toBe(
      'a < b && c — A',
    );
  });

  it('пусто и null — пустая строка', () => {
    expect(htmlToText(null)).toBe('');
    expect(htmlToText('')).toBe('');
  });
});

describe('plainToHtml', () => {
  it('экранирует и делит на абзацы', () => {
    expect(plainToHtml('Хорошо <b>\nвторая строка\n\nНовый абзац')).toBe(
      '<p>Хорошо &lt;b&gt;<br>вторая строка</p><p>Новый абзац</p>',
    );
  });
});

describe('isoTime / parseGrade / describeGradeType', () => {
  it('0 — не задано', () => {
    expect(isoTime(0)).toBeNull();
    expect(isoTime(1_700_000_000)).toBe('2023-11-14T22:13:20.000Z');
  });

  it('оценка -1 и пусто — null, строка — число', () => {
    expect(parseGrade('-1.00000')).toBeNull();
    expect(parseGrade('')).toBeNull();
    expect(parseGrade(undefined)).toBeNull();
    expect(parseGrade('85.50000')).toBe(85.5);
    expect(parseGrade('0.00000')).toBe(0);
  });

  it('знак поля grade различает баллы, шкалу и «без оценки»', () => {
    expect(describeGradeType(100)).toEqual({ type: 'points', max: 100 });
    expect(describeGradeType(-3)).toEqual({ type: 'scale', scaleId: 3 });
    expect(describeGradeType(0)).toEqual({ type: 'none' });
  });
});
