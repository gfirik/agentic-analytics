// MCP over stdio (`aa mcp`): what Claude Desktop and other local clients launch. Logs never go to stdout, which
// carries the protocol.
import type { JobManager } from "@agentic-analytics/core";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer, type McpOptions } from "./server.ts";

/** Unexpected errors go to stderr unless the caller logs them elsewhere: the client only sees a generic message. */
const toStderr = (err: unknown) =>
  process.stderr.write(`internal error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);

export async function serveStdio(manager: JobManager, o: McpOptions = {}): Promise<void> {
  await createMcpServer(manager, { ...o, onError: o.onError ?? toStderr }).connect(new StdioServerTransport());
}
