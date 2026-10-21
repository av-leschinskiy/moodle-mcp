/**
 * Хранилище токена веб-сервиса Moodle на диске.
 *
 * Файл: `~/.config/mcp-moodle/token.json` (путь настраивается через
 * MOODLE_TOKEN_FILE), формат `{"site","token","privatetoken"}`. Создаётся
 * `moodle-mcp-login`; читается сервером при каждом запросе.
 *
 * Права 0600 (только владелец) — не secret-vault, но и не plaintext в `/tmp`.
 *
 * Ни одно сообщение об ошибке отсюда не содержит содержимого файла: текст
 * `SyntaxError` из `JSON.parse` цитирует кусок входа, а вход — это токен.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { getConfig, normalizeSiteUrl } from '../config.js';
const LOGIN_HINT = 'Выполните: npx moodle-mcp-login';
const tokenFileSchema = z.object({
    /** wwwroot сайта, для которого выпущен токен. */
    site: z.string().url(),
    token: z.string().min(1),
    /**
     * Второй токен из ответа launch.php: им мобильное приложение получает
     * автологин-ключ. Серверу не нужен, но сохраняется — формат общий с
     * прежними файлами, и выбрасывать выданное сайтом незачем.
     */
    privatetoken: z.string().optional(),
});
export async function readToken(path) {
    let raw;
    try {
        raw = await readFile(path, 'utf8');
    }
    catch (err) {
        if (isNodeError(err) && err.code === 'ENOENT')
            return null;
        throw new Error(`Не удалось прочитать файл токена ${path} (${errorCode(err)}).`);
    }
    let json;
    try {
        json = JSON.parse(raw);
    }
    catch {
        throw new Error(`Файл токена ${path} не соответствует формату. ${LOGIN_HINT}`);
    }
    const parsed = tokenFileSchema.safeParse(json);
    if (!parsed.success) {
        throw new Error(`Файл токена ${path} не соответствует формату. ${LOGIN_HINT}`);
    }
    return parsed.data;
}
export async function writeToken(path, stored) {
    tokenFileSchema.parse(stored);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    // Временный файл рядом и rename: в пределах одной ФС это атомарно, и
    // работающий сервер видит либо прежний токен целиком, либо новый.
    const tmpPath = `${path}.tmp-${process.pid}`;
    try {
        await writeFile(tmpPath, JSON.stringify(stored), { mode: 0o600 });
        await rename(tmpPath, path);
    }
    catch (err) {
        await rm(tmpPath, { force: true });
        throw err;
    }
}
/**
 * Токен для запроса: `MOODLE_TOKEN` из env либо файл токена.
 *
 * Файл читается на каждый вызов (он крошечный): перелогин подхватывается без
 * перезапуска хоста. Сайт в файле обязан совпасть с MOODLE_URL — токен одного
 * Moodle на другом не работает, а ошибка `invalidtoken` от чужого сайта
 * не подсказывает, в чём дело.
 */
export async function getToken() {
    const cfg = getConfig();
    if (cfg.MOODLE_TOKEN)
        return cfg.MOODLE_TOKEN;
    const stored = await readToken(cfg.MOODLE_TOKEN_FILE);
    if (!stored) {
        throw new Error(`Нет файла токена ${cfg.MOODLE_TOKEN_FILE}. ${LOGIN_HINT}`);
    }
    if (normalizeSiteUrl(stored.site) !== cfg.MOODLE_URL) {
        throw new Error(`Токен в ${cfg.MOODLE_TOKEN_FILE} выпущен для ${stored.site}, а MOODLE_URL = ${cfg.MOODLE_URL}. ${LOGIN_HINT}`);
    }
    return stored.token;
}
function isNodeError(err) {
    return err instanceof Error && 'code' in err;
}
function errorCode(err) {
    return isNodeError(err) && err.code ? err.code : 'неизвестная ошибка';
}
//# sourceMappingURL=token-store.js.map