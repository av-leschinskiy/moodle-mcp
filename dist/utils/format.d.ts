/**
 * Приведение ответов Moodle к компактной форме для модели.
 *
 * Moodle отдаёт описания и тексты сдач HTML-ом, время — unix-секундами (0 —
 * «не задано»), оценки — строками вида `"85.00000"` (`-1` — «нет оценки»).
 * Модели нужен простой текст, ISO-время и число либо null.
 */
/**
 * HTML → простой текст: абзацы и переводы строк сохраняются, пункты списков
 * получают `- `, ссылки — адрес в скобках, остальные теги выбрасываются.
 * Это не санитайзер и не рендерер: задача — чтобы модель прочитала текст
 * задания или сдачи без разметки.
 */
export declare function htmlToText(html: string | null | undefined): string;
export declare function escapeHtml(text: string): string;
/**
 * Простой текст → HTML для редактора Moodle: экранирование, пустая строка —
 * новый абзац, одиночный перевод строки — `<br>`.
 */
export declare function plainToHtml(text: string): string;
/** Unix-секунды → ISO-строка; 0/пусто — null. */
export declare function isoTime(seconds: number | null | undefined): string | null;
/** Оценка Moodle → число; `-1`, пусто и мусор — null («не оценено»). */
export declare function parseGrade(raw: string | number | null | undefined): number | null;
/**
 * Поле `grade` задания: положительное — максимум баллов, отрицательное —
 * id шкалы со знаком минус, 0 — задание без оценки.
 */
export declare function describeGradeType(grade: number): {
    type: 'points';
    max: number;
} | {
    type: 'scale';
    scaleId: number;
} | {
    type: 'none';
};
//# sourceMappingURL=format.d.ts.map