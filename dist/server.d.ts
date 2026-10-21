/**
 * Moodle MCP Server
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { type MoodleClient } from './api/moodle-client.js';
export interface CreateServerOptions {
    client?: MoodleClient;
}
export declare function createServer(options?: CreateServerOptions): McpServer;
export declare function runServer(): Promise<void>;
//# sourceMappingURL=server.d.ts.map