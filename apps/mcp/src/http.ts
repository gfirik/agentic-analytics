// MCP over streamable HTTP, mounted by `aa serve` at /mcp. Stateless: a fresh server and transport per request
// (no session id generator), so any number of clients can call it without session bookkeeping.
import type { JobManager } from "@agentic-analytics/core";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer, type McpOptions } from "./server.ts";

export function mcpHttpHandler(manager: JobManager, o: McpOptions = {}): (req: Request) => Promise<Response> {
  return async (req) => {
    const server = createMcpServer(manager, o);
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(req);
  };
}
