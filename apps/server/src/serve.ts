// Starts the HTTP door on Node (`aa serve`). Localhost by default; CORS stays off (interfaces §1).

import type { AddressInfo } from "node:net";
import type { JobManager } from "@agentic-analytics/core";
import { createAdaptorServer } from "@hono/node-server";
import { createApp, type ServerOptions } from "./app.ts";

export type ServeErrorCode = "NO_AUTH_ON_NETWORK" | "PORT_IN_USE" | "NO_PERMISSION" | "LISTEN_FAILED";

/** Thrown when the server won't or can't listen: a network bind with no API token, or a port it can't take. */
export class ServeError extends Error {
  constructor(
    readonly code: ServeErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ServeError";
  }
}

const noAuth = (hostname: string) =>
  new ServeError(
    "NO_AUTH_ON_NETWORK",
    `refusing to listen on ${hostname} without API_TOKEN: anyone who can reach this address could read and delete jobs and call /mcp. Set API_TOKEN, or pass --allow-no-auth when a proxy or a localhost-only port mapping (docker-compose) keeps it private.`,
  );

/** A listen failure as a one-line message with the fix, instead of an unhandled 'error' event and a stack trace. */
function listenError(err: Error, hostname: string, port: number): ServeError {
  const code = "code" in err ? err.code : undefined;
  if (code === "EADDRINUSE")
    return new ServeError("PORT_IN_USE", `port ${port} on ${hostname} is in use; stop the other server or pass --port`, { cause: err });
  if (code === "EACCES")
    return new ServeError("NO_PERMISSION", `no permission to listen on port ${port}; use a port above 1023 with --port`, { cause: err });
  return new ServeError("LISTEN_FAILED", `can't listen on ${hostname}:${port}: ${err.message}`, { cause: err });
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
  if (!o.token && !o.allowNoAuth && !isLoopback(hostname)) return Promise.reject(noAuth(hostname));
  const app = createApp(manager, o);
  const port = o.port ?? 8080;
  return new Promise((resolve, reject) => {
    const server = createAdaptorServer({ fetch: app.fetch, hostname });
    // Listening for 'error' before listen: a taken port rejects instead of crashing the process. Removed once
    // listening, so a later server error is not silently caught here.
    const failed = (err: Error) => reject(listenError(err, hostname, port));
    server.once("error", failed);
    server.listen(port, hostname, () => {
      server.off("error", failed);
      const info = server.address() as AddressInfo;
      resolve({
        url: `http://${info.address.includes(":") ? `[${info.address}]` : info.address}:${info.port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}
