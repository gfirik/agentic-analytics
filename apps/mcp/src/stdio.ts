// MCP over stdio (`aa mcp`): what Claude Desktop and other local clients launch. Logs never go to stdout, which
// carries the protocol.
import type { JobManager } from "@agentic-analytics/core";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer, type McpOptions } from "./server.ts";

export async function serveStdio(manager: JobManager, o: McpOptions = {}): Promise<void> {
  await createMcpServer(manager, o).connect(new StdioServerTransport());
}
