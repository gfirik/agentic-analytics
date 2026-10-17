// Public API of @agentic-analytics/mcp (docs/specs/interfaces.md §3).

export { mcpHttpHandler } from "./http.ts";
export { allowedPath, createMcpServer, type McpOptions, PathNotAllowedError } from "./server.ts";
export { serveStdio } from "./stdio.ts";
