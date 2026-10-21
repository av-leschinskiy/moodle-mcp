/**
 * Приведение ответов Moodle к компактной форме для модели.
 *
 * Moodle отдаёт описания и тексты сдач HTML-ом, время — unix-секундами (0 —
 * «не задано»), оценки — строками вида `"85.00000"` (`-1` — «нет оценки»).
 * Модели нужен простой текст, ISO-время и число либо null.
 */
const NAMED_ENTITIES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    laquo: '«',
    raquo: '»',
    mdash: '—',
    ndash: '–',
    hellip: '…',
    copy: '©',
};
function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
        if (body[0] === '#') {
            const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
            return Number.isFinite(code) && code > 0 && code <= 0x10ffff
                ? String.fromCodePoint(code)
                : match;
        }
        return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    });
}
/**
 * HTML → простой текст: абзацы и переводы строк сохраняются, пункты списков
 * получают `- `, ссылки — адрес в скобках, остальные теги выбрасываются.
 * Это не санитайзер и не рендерер: задача — чтобы модель прочитала текст
 * задания или сдачи без разметки.
 */
export function htmlToText(html) {
    if (!html)
        return '';
    let text = html
        .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
        .replace(/<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => {
        const plain = label.replace(/<[^>]+>/g, '').trim();
        return plain && plain !== href ? `${plain} (${href})` : href;
    })
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<li[^>]*>/gi, '\n- ')
        .replace(/<\/(p|div|h[1-6]|ul|ol|tr|pre|blockquote|table)>/gi, '\n')
        .replace(/<(p|div|h[1-6]|ul|ol|tr|pre|blockquote|table)(\s[^>]*)?>/gi, '\n')
        .replace(/<\/t[dh]>/gi, '\t')
        .replace(/<[^>]+>/g, '');
    text = decodeEntities(text)
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t ]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n');
    return text.trim();
}
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
/**
 * Простой текст → HTML для редактора Moodle: экранирование, пустая строка —
 * новый абзац, одиночный перевод строки — `<br>`.
 */
export function plainToHtml(text) {
    return text
        .replace(/\r\n?/g, '\n')
        .trim()
        .split(/\n{2,}/)
        .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
        .join('');
}
/** Unix-секунды → ISO-строка; 0/пусто — null. */
export function isoTime(seconds) {
    return seconds ? new Date(seconds * 1000).toISOString() : null;
}
/** Оценка Moodle → число; `-1`, пусто и мусор — null («не оценено»). */
export function parseGrade(raw) {
    if (raw === null || raw === undefined || raw === '')
        return null;
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value) || value < 0)
        return null;
    return value;
}
/**
 * Поле `grade` задания: положительное — максимум баллов, отрицательное —
 * id шкалы со знаком минус, 0 — задание без оценки.
 */
export function describeGradeType(grade) {
    if (grade > 0)
        return { type: 'points', max: grade };
    if (grade < 0)
        return { type: 'scale', scaleId: -grade };
    return { type: 'none' };
}
//# sourceMappingURL=format.js.map