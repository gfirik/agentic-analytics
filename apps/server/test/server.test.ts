// M10: the HTTP door (interfaces §1). Every endpoint through `app.request`: upload → events → metric review →
// report (JSON and HTML) → ask → explain → delete, plus health, OpenAPI, bearer auth and MCP at /mcp.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobManager } from "@agentic-analytics/core";
import { coffeePlanner } from "@agentic-analytics/core/testing";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import { mcpHttpHandler } from "@agentic-analytics/mcp";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import type { Report } from "@agentic-analytics/schema";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/index.ts";

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
    expect((await withViewer.request("/../../etc/passwd")).status).toBe(200);
    expect(await (await withViewer.request("/../../etc/passwd")).text()).toContain("<div id=root>");
    expect(await (await app.request("/")).text()).toContain("The viewer is not built");
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
});
