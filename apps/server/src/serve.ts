// Starts the HTTP door on Node (`aa serve`). Localhost by default; CORS stays off (interfaces §1).

import type { JobManager } from "@agentic-analytics/core";
import { serve } from "@hono/node-server";
import { createApp, type ServerOptions } from "./app.ts";

export function startServer(
  manager: JobManager,
  o: ServerOptions & { port?: number; hostname?: string },
): Promise<{ url: string; close: () => Promise<void> }> {
  const app = createApp(manager, o);
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: o.port ?? 8080, hostname: o.hostname ?? "127.0.0.1" }, (info) =>
      resolve({
        url: `http://${info.address.includes(":") ? `[${info.address}]` : info.address}:${info.port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      }),
    );
  });
}
