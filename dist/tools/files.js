/**
 * Скачивание файлов сдачи на локальный диск.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { extname, isAbsolute, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { getMoodleClient } from '../api/moodle-client.js';
import { defineTool, reqOpts } from './types.js';
/**
 * Имя файла из последнего сегмента URL, безопасное для ФС: без разделителей
 * путей, управляющих символов и `..` — имя приходит с сервера, и писать по
 * нему за пределы destDir нельзя.
 */
export function safeFileName(url) {
    const segment = url.pathname.split('/').pop() ?? '';
    let name;
    try {
        name = decodeURIComponent(segment);
    }
    catch {
        name = segment;
    }
    name = name.replace(/[/\\\u0000-\u001f<>:"|?*]/g, '_').trim();
    if (name === '' || name === '.' || name === '..')
        return 'file';
    return name;
}
/** Свободный путь: `name.ext`, затем `name (1).ext`, … — чужой файл не затираем. */
async function freePath(dir, name) {
    const ext = extname(name);
    const base = name.slice(0, name.length - ext.length);
    for (let i = 0;; i++) {
        const candidate = join(dir, i === 0 ? name : `${base} (${i})${ext}`);
        try {
            await stat(candidate);
        }
        catch {
            return candidate;
        }
    }
}
export const filesTools = {
    moodle_download_file: defineTool({
        description: 'Скачивает файл сдачи (или вложение задания) на локальный диск и возвращает путь. ' +
            'fileUrl — поле url из moodle_get_submission или moodle_list_assignments. ' +
            'Существующий файл не перезаписывается: к имени добавляется « (1)».',
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
        inputSchema: z.object({
            fileUrl: z
                .string()
                .url()
                .describe('Ссылка на файл Moodle (…/pluginfile.php/…) с этого сайта'),
            destDir: z
                .string()
                .min(1)
                .refine(isAbsolute, 'нужен абсолютный путь')
                .describe('Абсолютный путь каталога для сохранения; создаётся, если его нет'),
        }),
        async execute(args, signal) {
            const { url, response } = await getMoodleClient().openFile(args.fileUrl, reqOpts(signal));
            await mkdir(args.destDir, { recursive: true });
            const path = await freePath(args.destDir, safeFileName(url));
            if (!response.body)
                throw new Error('Moodle вернул пустой ответ вместо файла.');
            try {
                await pipeline(Readable.fromWeb(response.body), createWriteStream(path, { flags: 'wx' }), signal ? { signal } : {});
            }
            catch (err) {
                await rm(path, { force: true });
                throw err;
            }
            const { size } = await stat(path);
            return {
                path,
                bytes: size,
                mimeType: response.headers.get('content-type')?.split(';')[0]?.trim() ?? null,
            };
        },
    }),
};
//# sourceMappingURL=files.js.map