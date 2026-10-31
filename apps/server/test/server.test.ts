// M10: the HTTP door (interfaces §1). Every endpoint through `app.request`: upload → events → metric review →
// report (JSON and HTML) → ask → explain → delete, plus health, OpenAPI, bearer auth and MCP at /mcp.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobManager, ManagerError } from "@agentic-analytics/core";
import { coffeePlanner } from "@agentic-analytics/core/testing";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import { mcpHttpHandler } from "@agentic-analytics/mcp";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { JobEvent, type Report } from "@agentic-analytics/schema";
import { afterAll, describe, expect, it } from "vitest";
import { createApp, isLoopback, ServeError, startServer } from "../src/index.ts";

const root = mkdtempSync(join(tmpdir(), "aa-srv-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const manager = new JobManager({ root, model: coffeePlanner(), deps: () => ({ model: coffeePlanner(), embedder: hashEmbedder() }) });
const app = createApp(manager, { today: () => "2026-07-01", mcp: mcpHttpHandler(manager, { today: () => "2026-07-01" }) });

function upload(options: unknown): FormData {
  const form = new FormData();
  for (const [name, bytes] of Object.entries(coffeeRoasterFiles())) form.append("files[]", new File([bytes], name));
  form.append("options", JSON.stringify(options));
  return form;
}

async function sse(id: string): Promise<{ event: string; data: { type: string } }[]> {
  const res = await app.request(`/v1/jobs/${id}/events`);
  expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((b) => b.includes("data:"))
    .map((b) => ({
      event: /event: (.*)/.exec(b)?.[1] ?? "",
      data: JSON.parse(/data: (.*)/.exec(b)?.[1] ?? "{}") as { type: string },
    }));
}

describe("HTTP API: roles on the confirm screen (M15)", () => {
  const post = (id: string, body: string) =>
    app.request(`/v1/jobs/${id}/metrics`, { method: "POST", body, headers: { "content-type": "application/yaml" } });
  const view = async (id: string) =>
    (await (await app.request(`/v1/jobs/${id}/metrics`)).json()) as {
      yaml: string;
      metrics: { id: string }[];
      roles: { table: string; column: string; role: string; status: string; source: string }[];
      table_kinds: { table: string; kind: string }[];
      business_model: { status: string };
    };
  let id: string;

  it("the awaiting-confirmation job serves metrics, roles with evidence, table kinds and the business model", async () => {
    const res = await app.request("/v1/jobs", { method: "POST", body: upload({ currency: "USD", auto_confirm: false }) });
    id = ((await res.json()) as { job_id: string }).job_id;
    expect((await sse(id)).at(-1)?.event).toBe("awaiting_confirmation");
    const v = await view(id);
    expect(v.roles.find((r) => r.table === "t_t1" && r.column === "qty")).toMatchObject({
      role: "quantity",
      status: "assumed",
      source: "detector",
    });
    expect(v.table_kinds[0]).toEqual({ table: "t_t1", table_id: "T1", kind: "sales_lines", evidence: expect.any(Array) });
    expect(v.business_model.status).toBe("assumed");
    // the response shape is in the generated OpenAPI document
    const spec = (await (await app.request("/openapi.json")).json()) as {
      paths: Record<
        string,
        { get?: { responses: Record<string, { content: { "application/json": { schema: { properties: object } } } }> } }
      >;
    };
    const props = spec.paths["/v1/jobs/{id}/metrics"]?.get?.responses["200"]?.content["application/json"].schema.properties;
    expect(Object.keys(props ?? {})).toEqual(expect.arrayContaining(["roles", "table_kinds", "business_model", "vocabulary"]));
  }, 180_000);

  it("refuses an unknown role or column with a typed 400 and applies nothing", async () => {
    const unknownRole = await post(id, "version: 1\nroles:\n  - { table: t_t1, column: qty, role: wizard }\n");
    expect(unknownRole.status).toBe(400);
    expect(((await unknownRole.json()) as { error: { code: string } }).error.code).toBe("UNKNOWN_ROLE");
    const unknownColumn = await post(id, "version: 1\nroles:\n  - { table: t_t1, column: nope, role: quantity }\n");
    expect(unknownColumn.status).toBe(400);
    expect(((await unknownColumn.json()) as { error: { code: string } }).error.code).toBe("UNKNOWN_COLUMN");
    expect((await view(id)).roles.every((r) => r.status === "assumed")).toBe(true);
  });

  it("a roles-only body re-drafts the metrics and keeps waiting; the full body confirms roles and resumes", async () => {
    const before = await view(id);
    expect(before.metrics.map((m) => m.id)).toContain("retail_revenue");
    const revised = await post(id, "version: 1\nroles:\n  - { table: t_t1, column: channel, role: dimension }\n");
    expect(revised.status).toBe(202);
    expect(((await revised.json()) as { status: string }).status).toBe("awaiting_confirmation");
    const v = await view(id);
    expect(v.metrics.map((m) => m.id)).toEqual([
      "revenue",
      "orders",
      "units",
      "customers",
      "new_customers",
      "returning_customers",
      "aov",
      "refund_rate",
    ]);
    expect(v.roles.find((r) => r.column === "channel")).toMatchObject({ role: "dimension", status: "confirmed", source: "user" });
    expect((await post(id, v.yaml)).status).toBe(202);
    expect((await sse(id)).at(-1)?.event).toBe("done");
    const report = (await (await app.request(`/v1/jobs/${id}/report`)).json()) as Report;
    expect(report.roles?.every((r) => r.status === "confirmed")).toBe(true);
    expect(report.metrics.map((m) => m.id)).toEqual([
      "revenue",
      "orders",
      "units",
      "customers",
      "new_customers",
      "returning_customers",
      "aov",
      "refund_rate",
    ]);
  }, 240_000);
});

describe("HTTP API", () => {
  let id: string;

  it("POST /v1/jobs accepts files and options and returns 202 with the job id", async () => {
    const res = await app.request("/v1/jobs", { method: "POST", body: upload({ currency: "USD", auto_confirm: false }) });
    if (res.status !== 202) throw new Error(await res.text());
    const body = (await res.json()) as { job_id: string; status: string };
    expect(body.status).toBe("queued");
    id = body.job_id;
  });

  it("streams events over SSE until the job waits for confirmation", async () => {
    const events = await sse(id);
    expect(events[0]?.event).toBe("stage_started");
    expect(events.at(-1)?.event).toBe("awaiting_confirmation");
    expect(events.every((e) => e.event === e.data.type)).toBe(true);
    const s = (await (await app.request(`/v1/jobs/${id}`)).json()) as { status: string; stage: string };
    expect(s).toMatchObject({ status: "awaiting_confirmation", stage: "AWAIT_CONFIRM" });
  }, 180_000);

  it("GET and POST /metrics: review, refuse an invalid edit, confirm and resume", async () => {
    const m = (await (await app.request(`/v1/jobs/${id}/metrics`)).json()) as { yaml: string; metrics: { text: string }[] };
    expect(m.metrics.length).toBeGreaterThan(0);
    const bad = await app.request(`/v1/jobs/${id}/metrics`, {
      method: "POST",
      body: "metrics: nope",
      headers: { "content-type": "application/yaml" },
    });
    expect(bad.status).toBe(400);
    const ok = await app.request(`/v1/jobs/${id}/metrics`, {
      method: "POST",
      body: m.yaml,
      headers: { "content-type": "application/yaml" },
    });
    expect(ok.status).toBe(202);
    const events = await sse(id);
    expect(events.at(-1)?.event).toBe("done");
    expect(((await (await app.request(`/v1/jobs/${id}`)).json()) as { status: string }).status).toBe("done");
  }, 180_000);

  it("GET /report gives JSON by default and HTML by Accept or ?format=html", async () => {
    const r = (await (await app.request(`/v1/jobs/${id}/report`)).json()) as Report;
    expect(r.findings.length).toBeGreaterThan(0);
    const h1 = await app.request(`/v1/jobs/${id}/report`, { headers: { accept: "text/html" } });
    expect(h1.headers.get("content-type")).toMatch(/text\/html/);
    expect(await (await app.request(`/v1/jobs/${id}/report?format=html`)).text()).toMatch(/^<!doctype html>/i);
    // Untrusted text on the viewer's origin: the HTML report runs sandboxed (security §4).
    expect(h1.headers.get("content-security-policy")).toBe("sandbox allow-scripts");
    expect(h1.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("POST /ask answers with verified claims; GET /facts explains a number", async () => {
    const a = await app.request(`/v1/jobs/${id}/ask`, {
      method: "POST",
      body: JSON.stringify({ question: "Why did revenue drop?" }),
      headers: { "content-type": "application/json" },
    });
    const body = (await a.json()) as { claims: { verified: boolean }[]; dropped: unknown[] };
    expect(body.claims).toHaveLength(1);
    expect(body.dropped).toHaveLength(1);
    const r = (await (await app.request(`/v1/jobs/${id}/report`)).json()) as Report;
    const fact = r.facts.find((f) => f.computation.kind === "sql");
    const x = (await (await app.request(`/v1/jobs/${id}/facts/${fact?.id}`)).json()) as { fact: { id: string } };
    expect(x.fact.id).toBe(fact?.id);
    expect((await app.request(`/v1/jobs/${id}/facts/N999999`)).status).toBe(404);
  }, 60_000);

  it("refusals keep their status: 413 for an upload over the limit, 400 for /ask without a body, never a 500", async () => {
    const logged: unknown[] = [];
    const small = createApp(manager, { maxUpload: 1024, onError: (e) => logged.push(e) });
    const big = await small.request("/v1/jobs", { method: "POST", body: upload({ currency: "USD" }) });
    expect(big.status).toBe(413);
    expect(await big.json()).toMatchObject({ error: { code: "TOO_LARGE" } });
    // No Content-Type and no body: validated anyway (an optional body was skipped and asked an undefined question).
    expect((await app.request(`/v1/jobs/${id}/ask`, { method: "POST" })).status).toBe(400);
    const plain = await small.request(`/v1/jobs/${id}/ask`, { method: "POST", body: "why?", headers: { "content-type": "text/plain" } });
    expect(plain.status).toBeGreaterThanOrEqual(400);
    expect(plain.status).toBeLessThan(500);
    expect(logged).toEqual([]);
  });

  it("an event stream whose job vanishes ends with one failed event, not an unhandled rejection", async () => {
    const vanished = Object.assign(Object.create(manager) as JobManager, {
      subscribe: async () => {
        throw new ManagerError("NOT_FOUND", "job x not found");
      },
    });
    const res = await createApp(vanished).request(`/v1/jobs/${id}/events`);
    const text = await res.text();
    expect(text).toContain("event: failed");
    // A valid job event under the shared schema (and its published JSON Schema).
    const data = /data: (.*)/.exec(text)?.[1] ?? "{}";
    expect(JobEvent.parse(JSON.parse(data))).toMatchObject({ type: "failed", seq: -1, error: { code: "NOT_FOUND" } });
    expect(text).toContain('"code":"NOT_FOUND"');
  });

  it("a client that leaves while the history is read leaves no listener behind", async () => {
    const listeners = () => (manager as unknown as { listeners: Map<string, Set<unknown>> }).listeners.get(id)?.size ?? 0;
    const before = listeners();
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    // The history read is slow: the client is gone before subscribe resolves.
    const slow = Object.assign(Object.create(manager) as JobManager, {
      subscribe: async (jobId: string, l: (e: JobEvent) => void) => {
        await gate;
        return manager.subscribe(jobId, l);
      },
    });
    const res = await createApp(slow).request(`/v1/jobs/${id}/events`);
    await res.body?.cancel();
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(listeners()).toBe(before);
  });

  it("a write that fails ends the stream and is reported, not an unhandled rejection", async () => {
    const logged: unknown[] = [];
    // An event type with a newline: writeSSE refuses it.
    const bad = Object.assign(Object.create(manager) as JobManager, {
      subscribe: async (jobId: string, l: (e: JobEvent) => void) => {
        l({ job_id: jobId, seq: 0, at: new Date().toISOString(), type: "done\nevent: x" } as unknown as JobEvent);
        l({ job_id: jobId, seq: 1, at: new Date().toISOString(), type: "done" } as unknown as JobEvent);
        return () => {};
      },
    });
    const res = await createApp(bad, { onError: (e) => logged.push(e) }).request(`/v1/jobs/${id}/events`);
    expect(await res.text()).toBe("");
    expect(logged).toHaveLength(1);
    expect(String(logged[0])).toMatch(/must not contain/);
  });

  it("refuses a `today` that is not a calendar date with a 400", async () => {
    for (const today of ["2026-13-45", "2026-02-30"]) {
      const res = await app.request("/v1/jobs", { method: "POST", body: upload({ today }) });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: "BAD_REQUEST", message: expect.stringMatching(/today.*calendar date/) } });
    }
  });

  it("validates input: bad options, no files, unknown job", async () => {
    expect((await app.request("/v1/jobs", { method: "POST", body: upload({ period: "2026-04" }) })).status).toBe(400);
    expect((await app.request("/v1/jobs", { method: "POST", body: new FormData() })).status).toBe(400);
    const nf = await app.request("/v1/jobs/nope");
    expect(nf.status).toBe(404);
    expect(await nf.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("health, OpenAPI and MCP over streamable HTTP", async () => {
    expect(await (await app.request("/v1/health")).json()).toMatchObject({
      ok: true,
      checks: { engine: { ok: true }, duckdb: { ok: true } },
    });
    const spec = (await (await app.request("/openapi.json")).json()) as { paths: Record<string, unknown> };
    for (const p of [
      "/v1/jobs",
      "/v1/jobs/{id}",
      "/v1/jobs/{id}/events",
      "/v1/jobs/{id}/metrics",
      "/v1/jobs/{id}/report",
      "/v1/jobs/{id}/ask",
      "/v1/jobs/{id}/facts/{factId}",
      "/v1/health",
    ])
      expect(Object.keys(spec.paths), p).toContain(p);
    const rpc = (method: string, params: unknown, n: number) =>
      app.request("/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: n, method, params }),
      });
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } }, 1);
    expect(init.status).toBe(200);
    const tools = (await (await rpc("tools/list", {}, 2)).json()) as { result: { tools: { name: string }[] } };
    expect(tools.result.tools.map((t) => t.name)).toContain("analyze_files");
  });

  it("serves the viewer at / (and index.html for client routes), or a pointer when it isn't built", async () => {
    const dir = join(root, "viewer-dist");
    mkdirSync(join(dir, "assets"), { recursive: true });
    writeFileSync(join(dir, "index.html"), "<!doctype html><div id=root></div>");
    writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
    const withViewer = createApp(manager, { viewerDir: dir });
    expect(await (await withViewer.request("/")).text()).toContain("<div id=root>");
    const js = await withViewer.request("/assets/app.js");
    expect(js.headers.get("content-type")).toBe("text/javascript");
    expect(await (await withViewer.request("/jobs/x")).text()).toContain("<div id=root>");
    // A directory whose name has a dot is not a file: the app shell, not a 500 (EISDIR).
    mkdirSync(join(dir, "v1.2"), { recursive: true });
    expect(await (await withViewer.request("/v1.2")).text()).toContain("<div id=root>");
    expect((await withViewer.request("/../../etc/passwd")).status).toBe(200);
    expect(await (await withViewer.request("/../../etc/passwd")).text()).toContain("<div id=root>");
    // A viewer folder without a build points at the build command; no viewer folder at all (the standalone binary)
    // points at a job's report.html instead.
    expect(await (await createApp(manager, { viewerDir: join(root, "no-build") }).request("/")).text()).toContain(
      "The viewer is not built",
    );
    expect(await (await app.request("/")).text()).toContain("This build has no viewer");
  });

  it("POST /resume re-queues a finished job (completed stages are kept) and 404s an unknown one", async () => {
    const r = await app.request(`/v1/jobs/${id}/resume`, { method: "POST" });
    expect(r.status).toBe(202);
    expect((await manager.wait(id)).status).toBe("done");
    expect((await app.request("/v1/jobs/nope/resume", { method: "POST" })).status).toBe(404);
  }, 60_000);

  it("refuses other hosts and origins (DNS rebinding) and malformed or traversing paths", async () => {
    for (const path of ["/v1/jobs", "/mcp", "/v1/health"]) {
      const r = await app.request(`http://evil.example${path}`, { method: path === "/mcp" ? "POST" : "GET" });
      expect(r.status, path).toBe(403);
    }
    expect((await app.request("/v1/jobs", { headers: { origin: "http://evil.example" } })).status).toBe(403);
    expect((await app.request("/v1/jobs", { method: "POST", headers: { origin: "null" }, body: new FormData() })).status).toBe(403);
    expect((await app.request("http://127.0.0.1:8080/v1/jobs", { headers: { origin: "http://localhost:5173" } })).status).toBe(200);
    expect((await createApp(manager, { allowedHosts: ["aa.lan"] }).request("http://aa.lan/v1/jobs")).status).toBe(200);
    const dir = join(root, "viewer-dist");
    const withViewer = createApp(manager, { viewerDir: dir });
    for (const p of ["/%2e%2e/%2e%2e/etc/passwd", "/assets/..%2f..%2f..%2fetc/passwd"])
      expect(await (await withViewer.request(p)).text(), p).toContain("<div id=root>");
    expect((await withViewer.request("/%E0%A4%A")).status).toBe(400);
  });

  it("DELETE removes the job", async () => {
    expect((await app.request(`/v1/jobs/${id}`, { method: "DELETE" })).status).toBe(204);
    expect((await app.request(`/v1/jobs/${id}`)).status).toBe(404);
  });

  it("with API_TOKEN, job routes need the bearer token; health stays open", async () => {
    const guarded = createApp(manager, { token: "s3cret" });
    expect((await guarded.request("/v1/jobs")).status).toBe(401);
    expect((await guarded.request("/v1/jobs", { headers: { authorization: "Bearer s3cret" } })).status).toBe(200);
    expect((await guarded.request("/mcp", { method: "POST" })).status).toBe(401);
    expect((await guarded.request("/v1/health")).status).toBe(200);
  });

  it("security review: health details need the token, 500s are generic, a network bind needs a token", async () => {
    let probed = 0;
    const health = async () => {
      probed++;
      return { "model call": { ok: true, detail: "planner openai-compatible:groq:m replied" } };
    };
    const guarded = createApp(manager, { token: "s3cret", health });
    // Without the token: engine and DuckDB only, and no model call behind it.
    const open = (await (await guarded.request("/v1/health")).json()) as { checks: Record<string, unknown> };
    expect(Object.keys(open.checks).sort()).toEqual(["duckdb", "engine"]);
    expect(probed).toBe(0);
    const full = (await (await guarded.request("/v1/health", { headers: { authorization: "Bearer s3cret" } })).json()) as {
      checks: Record<string, unknown>;
    };
    expect(full.checks["model call"]).toBeDefined();
    expect(probed).toBe(1);

    // An unexpected error reaches the log hook; the client gets no paths or SQL.
    const logged: unknown[] = [];
    const broken = Object.assign(Object.create(manager) as JobManager, {
      list: async () => {
        throw new Error("Binder Error at /home/owner/data/jobs/x/job.duckdb: SELECT secret");
      },
    });
    const failing = createApp(broken, { onError: (e) => logged.push(e) });
    const res = await failing.request("/v1/jobs");
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe("internal error (details are in the server log)");
    expect(logged).toHaveLength(1);

    // Beyond loopback, the server refuses to start without a token (or an explicit opt-out).
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("localhost")).toBe(true);
    expect(isLoopback("[::1]")).toBe(true);
    expect(isLoopback("0.0.0.0")).toBe(false);
    expect(isLoopback("192.168.1.5")).toBe(false);
    await expect(startServer(manager, { hostname: "0.0.0.0", port: 0 })).rejects.toBeInstanceOf(ServeError);
    const s = await startServer(manager, { hostname: "0.0.0.0", port: 0, token: "s3cret" });
    await s.close();
  });

  it("a port already in use rejects with a typed error instead of crashing the process", async () => {
    const taken = createServer();
    await new Promise<void>((r) => taken.listen(0, "127.0.0.1", r));
    const port = (taken.address() as { port: number }).port;
    try {
      const err = await startServer(manager, { port }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ServeError);
      expect(err).toMatchObject({
        code: "PORT_IN_USE",
        message: `port ${port} on 127.0.0.1 is in use; stop the other server or pass --port`,
      });
    } finally {
      await new Promise<void>((r) => taken.close(() => r()));
    }
  });
});
