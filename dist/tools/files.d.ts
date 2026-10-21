/**
 * Скачивание файлов сдачи на локальный диск.
 */
import { z } from 'zod';
/**
 * Имя файла из последнего сегмента URL, безопасное для ФС: без разделителей
 * путей, управляющих символов и `..` — имя приходит с сервера, и писать по
 * нему за пределы destDir нельзя.
 */
export declare function safeFileName(url: URL): string;
export declare const filesTools: {
    moodle_download_file: import("./types.js").ToolDef<z.ZodObject<{
        fileUrl: z.ZodString;
        destDir: z.ZodEffects<z.ZodString, string, string>;
    }, "strip", z.ZodTypeAny, {
        fileUrl: string;
        destDir: string;
    }, {
        fileUrl: string;
        destDir: string;
    }>, z.ZodTypeAny, {
        path: string;
        bytes: number;
        mimeType: string | null;
    }>;
};
//# sourceMappingURL=files.d.ts.map