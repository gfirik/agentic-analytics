// Starts the HTTP door on Node (`aa serve`). Localhost by default; CORS stays off (interfaces §1).

import type { JobManager } from "@agentic-analytics/core";
import { serve } from "@hono/node-server";
import { createApp, type ServerOptions } from "./app.ts";

/** Thrown when the server would listen beyond loopback with no API token. */
export class ServeError extends Error {
  readonly code = "NO_AUTH_ON_NETWORK";
  constructor(hostname: string) {
    super(
      `refusing to listen on ${hostname} without API_TOKEN: anyone who can reach this address could read and delete jobs and call /mcp. Set API_TOKEN, or pass --allow-no-auth when a proxy or a localhost-only port mapping (docker-compose) keeps it private.`,
    );
    this.name = "ServeError";
  }
}

/** Loopback names and addresses: the only interfaces the API may listen on without a token. */
export function isLoopback(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || /^127(\.\d{1,3}){3}$/.test(h);
}

export function startServer(
  manager: JobManager,
  o: ServerOptions & { port?: number; hostname?: string; allowNoAuth?: boolean },
): Promise<{ url: string; close: () => Promise<void> }> {
  // The Host/Origin guard stops DNS rebinding in browsers, not other clients: off loopback, only a token protects jobs.
  const hostname = o.hostname ?? "127.0.0.1";
  if (!o.token && !o.allowNoAuth && !isLoopback(hostname)) return Promise.reject(new ServeError(hostname));
  const app = createApp(manager, o);
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: o.port ?? 8080, hostname }, (info) =>
      resolve({
        url: `http://${info.address.includes(":") ? `[${info.address}]` : info.address}:${info.port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      }),
    );
  });
}
