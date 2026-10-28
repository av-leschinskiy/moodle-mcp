/**
 * Текст отзыва для плагина комментариев и картинки внутри него.
 *
 * Картинка отзыва — файл области `assignfeedback_comments/feedback`, на
 * который текст ссылается как `@@PLUGINFILE@@/<имя>`. Сюда файл попадает из
 * черновика пользователя при записи формы оценки, поэтому имя в тексте обязано
 * совпасть с именем загруженного файла буква в букву, иначе студент увидит
 * битую картинку.
 */
import { readFile, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute } from 'node:path';
import { escapeHtml, plainToHtml } from './format.js';
/** Форматы текста Moodle (FORMAT_HTML, FORMAT_MARKDOWN). */
export const FORMAT_HTML = 1;
export const FORMAT_MARKDOWN = 4;
/**
 * Предел одной картинки — 2 МиБ. Это `upload_max_filesize` PHP по умолчанию:
 * меньше этого сайт не примет ни при каких настройках Moodle, а больше —
 * зависит от сайта. Снимок экрана 1920×1080 в PNG обычно укладывается в
 * 0,2–1,5 МиБ; что не влезает — обрезать или сохранить в JPEG.
 */
export const MAX_FEEDBACK_IMAGE_BYTES = 2 * 1024 * 1024;
/** Не больше пяти картинок: отзыв читает человек, а не галерею. */
export const MAX_FEEDBACK_IMAGES = 5;
const IMAGE_TYPES = {
    '.png': {
        mime: 'image/png',
        magic: (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x),
    },
    '.jpg': { mime: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    '.jpeg': { mime: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    '.gif': {
        mime: 'image/gif',
        magic: (b) => ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a',
    },
    '.webp': {
        mime: 'image/webp',
        magic: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
    },
};
function ascii(bytes, from, to) {
    return String.fromCharCode(...bytes.subarray(from, to));
}
/**
 * Имя файла, которое Moodle сохранит как есть и которое не надо кодировать в
 * URL: латиница, цифры, `.`, `_`, `-`. Кириллицу и пробелы `clean_param`
 * Moodle и кодирование ссылки обработали бы по-своему, и имя в тексте
 * разошлось бы с именем файла.
 */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
/**
 * Читает и проверяет картинки до любого обращения к Moodle: только
 * абсолютные пути к обычным файлам, только PNG/JPEG/GIF/WebP по расширению и
 * по сигнатуре, не больше `MAX_FEEDBACK_IMAGE_BYTES`, имена без повторов.
 */
export async function loadFeedbackImages(specs) {
    if (specs.length > MAX_FEEDBACK_IMAGES) {
        throw new Error(`At most ${MAX_FEEDBACK_IMAGES} images can be attached to feedback.`);
    }
    const seen = new Set();
    const images = [];
    for (const spec of specs) {
        if (!isAbsolute(spec.path))
            throw new Error('Image path must be absolute.');
        const name = basename(spec.path);
        if (!SAFE_NAME.test(name)) {
            throw new Error(`Image file name "${name}" is not allowed: use Latin letters, digits, ".", "_", "-" (rename the file).`);
        }
        if (seen.has(name))
            throw new Error(`Two images are named "${name}"; names must be unique.`);
        seen.add(name);
        const type = IMAGE_TYPES[extname(name).toLowerCase()];
        if (!type)
            throw new Error(`"${name}" is not a PNG, JPEG, GIF or WebP image.`);
        const info = await stat(spec.path).catch(() => null);
        if (!info?.isFile())
            throw new Error(`Image "${name}" is not a readable file.`);
        if (info.size === 0 || info.size > MAX_FEEDBACK_IMAGE_BYTES) {
            throw new Error(`Image "${name}" is ${info.size} bytes; allowed 1…${MAX_FEEDBACK_IMAGE_BYTES} (crop it or save as JPEG).`);
        }
        const data = new Uint8Array(await readFile(spec.path));
        // Файл мог вырасти между stat и чтением.
        if (data.byteLength > MAX_FEEDBACK_IMAGE_BYTES) {
            throw new Error(`Image "${name}" is larger than ${MAX_FEEDBACK_IMAGE_BYTES} bytes.`);
        }
        if (!type.magic(data))
            throw new Error(`"${name}" content does not match its extension.`);
        images.push({ name, mimeType: type.mime, alt: spec.alt?.trim() ?? '', data });
    }
    return images;
}
const PLUGINFILE_REF = /@@PLUGINFILE@@\/([^"'\s<>)]+)/g;
/**
 * Текст и формат для `assignfeedbackcomments_editor`. plain уходит HTML-ом
 * (абзацы по пустой строке), markdown и html — как есть. Картинка, на которую
 * текст не сослался (`@@PLUGINFILE@@/<имя>` в html и markdown), добавляется в
 * конец; ссылка на файл, которого нет среди картинок, — отказ до записи.
 */
export function composeFeedback(feedback, format, images) {
    const names = new Set(images.map((i) => i.name));
    const referenced = new Set();
    if (format !== 'plain') {
        for (const [, raw] of feedback.matchAll(PLUGINFILE_REF)) {
            const name = safeDecode(raw ?? '');
            if (!names.has(name)) {
                throw new Error(`Feedback references @@PLUGINFILE@@/${name}, but no image with this file name is attached.`);
            }
            referenced.add(name);
        }
    }
    const rest = images.filter((i) => !referenced.has(i.name));
    if (format === 'markdown') {
        const tail = rest.map((i) => `![${i.alt.replace(/[[\]]/g, '')}](@@PLUGINFILE@@/${i.name})`);
        return { text: [feedback, ...tail].join('\n\n'), format: FORMAT_MARKDOWN };
    }
    const head = format === 'plain' ? plainToHtml(feedback) : feedback;
    const tail = rest.map((i) => `<p><img src="@@PLUGINFILE@@/${i.name}" alt="${escapeHtml(i.alt)}"></p>`);
    return { text: head + tail.join(''), format: FORMAT_HTML };
}
function safeDecode(text) {
    try {
        return decodeURIComponent(text);
    }
    catch {
        return text;
    }
}
//# sourceMappingURL=feedback-images.js.map