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
import { z } from 'zod';
/**
 * Подсказка войти заново. Команда — через `-p`: без него npx искал бы пакет
 * с именем команды, а `moodle-mcp-login` в npm — чужое, никем не занятое имя.
 */
export declare const LOGIN_HINT = "Run: npx -y -p @av-leschinskiy/moodle-mcp moodle-mcp-login";
declare const tokenFileSchema: z.ZodObject<{
    /** wwwroot сайта, для которого выпущен токен. */
    site: z.ZodString;
    token: z.ZodString;
    /**
     * Второй токен из ответа launch.php: им мобильное приложение получает
     * автологин-ключ. Серверу не нужен, но сохраняется — формат общий с
     * прежними файлами, и выбрасывать выданное сайтом незачем.
     */
    privatetoken: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    site: string;
    token: string;
    privatetoken?: string | undefined;
}, {
    site: string;
    token: string;
    privatetoken?: string | undefined;
}>;
export type StoredToken = z.infer<typeof tokenFileSchema>;
export declare function readToken(path: string): Promise<StoredToken | null>;
export declare function writeToken(path: string, stored: StoredToken): Promise<void>;
/**
 * Токен для запроса: `MOODLE_TOKEN` из env либо файл токена.
 *
 * Файл читается на каждый вызов (он крошечный): перелогин подхватывается без
 * перезапуска хоста. Сайт в файле обязан совпасть с MOODLE_URL — токен одного
 * Moodle на другом не работает, а ошибка `invalidtoken` от чужого сайта
 * не подсказывает, в чём дело.
 */
export declare function getToken(): Promise<string>;
export {};
//# sourceMappingURL=token-store.d.ts.map