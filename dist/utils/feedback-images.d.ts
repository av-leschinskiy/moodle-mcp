/**
 * Текст отзыва для плагина комментариев и картинки внутри него.
 *
 * Картинка отзыва — файл области `assignfeedback_comments/feedback`, на
 * который текст ссылается как `@@PLUGINFILE@@/<имя>`. Сюда файл попадает из
 * черновика пользователя при записи формы оценки, поэтому имя в тексте обязано
 * совпасть с именем загруженного файла буква в букву, иначе студент увидит
 * битую картинку.
 */
/** Форматы текста Moodle (FORMAT_HTML, FORMAT_MARKDOWN). */
export declare const FORMAT_HTML = 1;
export declare const FORMAT_MARKDOWN = 4;
/**
 * Предел одной картинки — 2 МиБ. Это `upload_max_filesize` PHP по умолчанию:
 * меньше этого сайт не примет ни при каких настройках Moodle, а больше —
 * зависит от сайта. Снимок экрана 1920×1080 в PNG обычно укладывается в
 * 0,2–1,5 МиБ; что не влезает — обрезать или сохранить в JPEG.
 */
export declare const MAX_FEEDBACK_IMAGE_BYTES: number;
/** Не больше пяти картинок: отзыв читает человек, а не галерею. */
export declare const MAX_FEEDBACK_IMAGES = 5;
export interface FeedbackImageSpec {
    path: string;
    alt?: string | undefined;
}
export interface FeedbackImage {
    name: string;
    mimeType: string;
    alt: string;
    data: Uint8Array<ArrayBuffer>;
}
/**
 * Читает и проверяет картинки до любого обращения к Moodle: только
 * абсолютные пути к обычным файлам, только PNG/JPEG/GIF/WebP по расширению и
 * по сигнатуре, не больше `MAX_FEEDBACK_IMAGE_BYTES`, имена без повторов.
 */
export declare function loadFeedbackImages(specs: FeedbackImageSpec[]): Promise<FeedbackImage[]>;
/**
 * Текст и формат для `assignfeedbackcomments_editor`. plain уходит HTML-ом
 * (абзацы по пустой строке), markdown и html — как есть. Картинка, на которую
 * текст не сослался (`@@PLUGINFILE@@/<имя>` в html и markdown), добавляется в
 * конец; ссылка на файл, которого нет среди картинок, — отказ до записи.
 */
export declare function composeFeedback(feedback: string, format: 'plain' | 'markdown' | 'html', images: Pick<FeedbackImage, 'name' | 'alt'>[]): {
    text: string;
    format: number;
};
//# sourceMappingURL=feedback-images.d.ts.map