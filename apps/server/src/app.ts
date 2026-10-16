// The HTTP door (interfaces §1): Hono with zod-openapi, so `/openapi.json` is generated from the same schemas that
// validate requests. Every route is a thin call into the job manager; no engine logic lives here.
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { type JobManager, ManagerError } from "@agentic-analytics/core";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";

export interface ServerOptions {
  /** Bearer token for every route except health and the OpenAPI spec (API_TOKEN); none means no auth (localhost). */
  readonly token?: string;
  /** Today's date for new jobs (default: the current date). */
  readonly today?: () => string;
  /** Extra availability checks for /v1/health (model, search, Docling); the engine and DuckDB are always reported. */
  readonly health?: () => Promise<Record<string, { ok: boolean; detail?: string }>>;
  /** MCP over streamable HTTP, mounted at /mcp. */
  readonly mcp?: (req: Request) => Promise<Response>;
  /** The built viewer (apps/viewer/dist), served at `/`. */
  readonly viewerDir?: string;
  /** Upload limit in bytes (default 200 MB). */
  readonly maxUpload?: number;
  readonly version?: string;
}

const JobId = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/)
  .openapi({ param: { name: "id", in: "path" }, example: "job-20260701090000-a1b2c3" });
const Problem = z.object({ error: z.object({ code: z.string(), message: z.string() }) }).openapi("Problem");
const Status = z
  .object({
    job_id: z.string(),
    status: z.enum(["queued", "running", "awaiting_confirmation", "done", "failed"]),
    stage: z.string().optional(),
    progress: z.number(),
    created_at: z.string(),
    updated_at: z.string(),
    timings: z.record(z.string(), z.number()),
    error: z.object({ code: z.string(), message: z.string(), stage: z.string().optional() }).optional(),
  })
  .openapi("JobStatus");
export const JobOptionsBody = z
  .object({
    web: z.boolean().optional(),
    objective: z.string().max(500).optional(),
    auto_confirm: z.boolean().optional(),
    small_model: z.boolean().optional(),
    currency: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional(),
    today: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict()
  .openapi("JobOptions");
const problems = {
  400: { description: "Bad request", content: { "application/json": { schema: Problem } } },
  404: { description: "No such job or fact", content: { "application/json": { schema: Problem } } },
  409: { description: "The job is running, or not ready", content: { "application/json": { schema: Problem } } },
};
const json = <T extends z.ZodType>(schema: T, description: string) => ({ description, content: { "application/json": { schema } } });

const STATUS: Record<ManagerError["code"], 400 | 404 | 409> = { BAD_REQUEST: 400, NOT_FOUND: 404, BUSY: 409, NOT_READY: 409 };
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

export function createApp(manager: JobManager, o: ServerOptions = {}): OpenAPIHono {
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success)
        return c.json(
          { error: { code: "BAD_REQUEST", message: result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ") } },
          400,
        );
    },
  });
  const today = o.today ?? (() => new Date().toISOString().slice(0, 10));

  app.onError((err, c) => {
    if (err instanceof ManagerError) return c.json({ error: { code: err.code, message: err.message } }, STATUS[err.code]);
    return c.json({ error: { code: "INTERNAL", message: err.message } }, 500);
  });

  if (o.token) {
    const expected = `Bearer ${o.token}`;
    const guard = async (c: Context, next: () => Promise<void>) => {
      if (c.req.header("authorization") !== expected)
        return c.json({ error: { code: "UNAUTHORIZED", message: "a bearer token is required" } }, 401);
      await next();
    };
    app.use("/v1/jobs/*", guard);
    app.use("/v1/jobs", guard);
    app.use("/mcp", guard);
  }
  app.openAPIRegistry.registerComponent("securitySchemes", "bearer", { type: "http", scheme: "bearer" });

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/jobs",
      summary: "Start a job on uploaded files",
      middleware: [bodyLimit({ maxSize: o.maxUpload ?? 200 * 1024 * 1024 })] as const,
      request: {
        body: {
          content: {
            "multipart/form-data": {
              schema: z.object({
                // Documented as binary strings; the handler reads the File objects itself (one file or many).
                "files[]": z.custom<File | File[]>().openapi({ type: "array", items: { type: "string", format: "binary" } }),
                options: z.string().optional().openapi({ description: "JSON: JobOptions" }),
              }),
            },
          },
        },
      },
      responses: { 202: json(Status, "Accepted"), ...problems },
    }),
    async (c) => {
      const body = await c.req.parseBody({ all: true });
      const raw = [body["files[]"], body.files].flat().filter((f): f is File => f instanceof File);
      if (!raw.length) return c.json({ error: { code: "BAD_REQUEST", message: "send one or more files as files[]" } }, 400);
      let parsed: z.infer<typeof JobOptionsBody>;
      try {
        const text = typeof body.options === "string" ? body.options : "{}";
        const r = JobOptionsBody.safeParse(JSON.parse(text));
        if (!r.success)
          return c.json(
            {
              error: {
                code: "BAD_REQUEST",
                message: `options: ${r.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ")}`,
              },
            },
            400,
          );
        parsed = r.data;
      } catch {
        return c.json({ error: { code: "BAD_REQUEST", message: "options must be JSON" } }, 400);
      }
      const files = await Promise.all(raw.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
      const s = await manager.create(files, {
        today: parsed.today ?? today(),
        ...(parsed.currency ? { currency: parsed.currency.toUpperCase() } : {}),
        ...(parsed.objective ? { objective: parsed.objective } : {}),
        ...(parsed.web ? { web: true } : {}),
        ...(parsed.small_model ? { smallModel: true } : {}),
        autoConfirm: parsed.auto_confirm ?? true,
      });
      return c.json(s, 202);
    },
  );

  app.openapi(
    createRoute({ method: "get", path: "/v1/jobs", summary: "List jobs", responses: { 200: json(z.array(Status), "Jobs") } }),
    async (c) => c.json(await manager.list(), 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/jobs/{id}",
      summary: "Job status, current stage, progress, timings and errors",
      request: { params: z.object({ id: JobId }) },
      responses: { 200: json(Status, "Status"), ...problems },
    }),
    async (c) => c.json(await manager.status(c.req.valid("param").id), 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/jobs/{id}/events",
      summary: "Server-Sent Events: stage_started, stage_completed, progress, awaiting_confirmation, warning, done, failed",
      request: { params: z.object({ id: JobId }) },
      responses: { 200: { description: "text/event-stream", content: { "text/event-stream": { schema: z.string() } } }, ...problems },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      await manager.status(id); // 404 before the stream starts
      return streamSSE(c, async (stream) => {
        // History first, then live events. Only a live terminal event ends the stream: a resumed job's history
        // holds an earlier `awaiting_confirmation`.
        let live = false;
        let writes = Promise.resolve();
        let unsubscribe: (() => void) | undefined;
        const finished = new Promise<void>((resolve) => {
          stream.onAbort(() => resolve());
          void manager
            .subscribe(id, (e) => {
              writes = writes.then(() => stream.writeSSE({ event: e.type, id: String(e.seq), data: JSON.stringify(e) }));
              if (live && (e.type === "done" || e.type === "failed" || e.type === "awaiting_confirmation")) void writes.then(resolve);
            })
            .then(async (u) => {
              unsubscribe = u;
              live = true;
              const s = await manager.status(id);
              if (s.status !== "running" && s.status !== "queued") void writes.then(resolve);
            });
        });
        await finished;
        unsubscribe?.();
      });
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/jobs/{id}/metrics",
      summary: "Drafted metric definitions as YAML, and each in plain words",
      request: { params: z.object({ id: JobId }) },
      responses: {
        200: json(
          z.object({ yaml: z.string(), metrics: z.array(z.object({ id: z.string(), status: z.string(), text: z.string() })) }),
          "Metrics",
        ),
        ...problems,
      },
    }),
    async (c) => c.json(await manager.metrics(c.req.valid("param").id), 200),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/jobs/{id}/metrics",
      summary: "Confirm or edit the metric definitions (YAML body); the job resumes",
      request: {
        params: z.object({ id: JobId }),
        body: { content: { "application/yaml": { schema: z.string() }, "text/plain": { schema: z.string() } } },
      },
      responses: { 202: json(Status, "Resumed"), ...problems },
    }),
    async (c) => c.json(await manager.confirm(c.req.valid("param").id, await c.req.text()), 202),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/jobs/{id}/report",
      summary: "report.json (Accept: application/json) or report.html (Accept: text/html, or ?format=html)",
      request: { params: z.object({ id: JobId }), query: z.object({ format: z.enum(["json", "html"]).optional() }) },
      responses: {
        200: {
          description: "The verified report",
          content: { "application/json": { schema: z.object({}).passthrough() }, "text/html": { schema: z.string() } },
        },
        ...problems,
      },
    }),
    async (c) => {
      const { id } = c.req.valid("param");
      const html =
        c.req.valid("query").format === "html" || (!c.req.valid("query").format && /text\/html/.test(c.req.header("accept") ?? ""));
      if (html) return c.html(await manager.reportHtml(id), 200);
      return c.json(await manager.report(id), 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/jobs/{id}/ask",
      summary: "Ask a follow-up question; the answer is verified claims with facts and citations",
      request: {
        params: z.object({ id: JobId }),
        body: { content: { "application/json": { schema: z.object({ question: z.string().min(3).max(500) }) } } },
      },
      responses: {
        200: json(
          z.object({
            question: z.string(),
            claims: z.array(z.object({}).passthrough()),
            facts: z.array(z.object({}).passthrough()),
            dropped: z.array(z.object({ claim: z.string(), reason: z.string() })),
            notCovered: z.string().optional(),
          }),
          "Answer",
        ),
        ...problems,
      },
    }),
    async (c) => c.json(JSON.parse(JSON.stringify(await manager.ask(c.req.valid("param").id, c.req.valid("json").question))), 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/jobs/{id}/facts/{factId}",
      summary: "Explain a number: SQL, parameters, definition and input rows",
      request: {
        params: z.object({
          id: JobId,
          factId: z
            .string()
            .regex(/^N\d+$/)
            .openapi({ param: { name: "factId", in: "path" } }),
        }),
      },
      responses: { 200: json(z.object({}).passthrough(), "Explanation"), ...problems },
    }),
    async (c) => {
      const p = c.req.valid("param");
      return c.json(JSON.parse(JSON.stringify(await manager.explain(p.id, p.factId))) as Record<string, unknown>, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "delete",
      path: "/v1/jobs/{id}",
      summary: "Delete a job and its data",
      request: { params: z.object({ id: JobId }) },
      responses: { 204: { description: "Deleted" }, ...problems },
    }),
    async (c) => {
      await manager.delete(c.req.valid("param").id);
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/health",
      summary: "Engine, DuckDB, model, search and Docling availability",
      responses: {
        200: json(
          z.object({
            ok: z.boolean(),
            version: z.string(),
            checks: z.record(z.string(), z.object({ ok: z.boolean(), detail: z.string().optional() })),
          }),
          "Health",
        ),
      },
    }),
    async (c) => {
      const checks: Record<string, { ok: boolean; detail?: string }> = {
        engine: { ok: true },
        duckdb: { ok: true },
        ...(o.health ? await o.health() : {}),
      };
      return c.json({ ok: checks.engine?.ok === true && checks.duckdb?.ok === true, version: o.version ?? "0.0.0", checks }, 200);
    },
  );

  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "agentic-analytics", version: o.version ?? "0.0.0", description: "Files in, a verified and cited report out." },
    ...(o.token ? { security: [{ bearer: [] }] } : {}),
  });

  if (o.mcp) {
    const handler = o.mcp;
    app.all("/mcp", (c) => handler(c.req.raw));
  }

  // The viewer: static files from its build, with index.html for client-side routes.
  app.get("*", (c) => {
    const dir = o.viewerDir;
    if (!dir || !existsSync(join(dir, "index.html")))
      return c.html(
        '<!doctype html><title>agentic-analytics</title><p>The API is running. The viewer is not built: run <code>bun run --filter @agentic-analytics/viewer build</code>. API spec: <a href="/openapi.json">/openapi.json</a>.</p>',
        200,
      );
    const rel = normalize(decodeURIComponent(new URL(c.req.url).pathname)).replace(/^([/\\])+/, "");
    const file = join(dir, rel);
    if (rel && !rel.startsWith("..") && existsSync(file) && extname(file))
      return c.body(readFileSync(file), 200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    return c.html(readFileSync(join(dir, "index.html"), "utf8"), 200);
  });
  return app;
}
