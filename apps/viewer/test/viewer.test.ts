// M10: the viewer's state and API client against the real HTTP API, and its pages rendered on the server.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobManager } from "@agentic-analytics/core";
import { coffeePlanner } from "@agentic-analytics/core/testing";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import type { JobEvent } from "@agentic-analytics/schema";
import { createApp } from "@agentic-analytics/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it } from "vitest";
import { Pipeline, UploadPage } from "../src/App.tsx";
import { createApi, initialView, reduce } from "../src/index.ts";

const root = mkdtempSync(join(tmpdir(), "aa-viewer-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const manager = new JobManager({ root, model: coffeePlanner(), deps: () => ({ model: coffeePlanner(), embedder: hashEmbedder() }) });
const app = createApp(manager, { today: () => "2026-07-01" });
const api = createApi("http://viewer.local", undefined, (async (u: string | URL | Request, i?: RequestInit) =>
  app.request(String(u), i)) as typeof fetch);

describe("viewer", () => {
  it("upload → live events → metric confirmation → report, through the API client and the reducer", async () => {
    const files = Object.entries(coffeeRoasterFiles()).map(([n, b]) => new File([b as Uint8Array<ArrayBuffer>], n));
    const id = await api.createJob(files, { auto_confirm: false, currency: "USD" });
    let view = initialView();
    await api.follow(id, (e: JobEvent) => {
      view = reduce(view, e);
    });
    expect(view.phase).toBe("awaiting_confirmation");
    expect(view.stages.INGEST).toBe("done");
    expect(view.stages.AWAIT_CONFIRM).toBe("waiting");
    const m = await api.metrics(id);
    await api.confirm(id, m.yaml);
    await api.follow(id, (e) => {
      view = reduce(view, e);
    });
    expect(view.phase).toBe("done");
    expect(view.stages.RENDER).toBe("done");
    expect(await api.reportHtml(id)).toMatch(/^<!doctype html>/i);
    expect((await api.jobs()).map((j) => j.job_id)).toContain(id);
  }, 180_000);

  it("a failed stage shows its error; warnings are kept", () => {
    const base = { job_id: "j", seq: 0, at: "2026-07-01T00:00:00.000Z" };
    let v = reduce(initialView(), { ...base, type: "stage_started", stage: "EXPLAIN" });
    v = reduce(v, { ...base, type: "warning", stage: "EXPLAIN", code: "W", message: "web off" });
    v = reduce(v, { ...base, type: "failed", stage: "EXPLAIN", error: { code: "PROVIDER", message: "no model" } });
    expect(v).toMatchObject({ phase: "failed", error: "PROVIDER: no model", warnings: ["web off"] });
    expect(v.stages.EXPLAIN).toBe("failed");
  });

  it("renders the pipeline and the upload page", () => {
    const html = renderToStaticMarkup(
      createElement(Pipeline, {
        view: reduce(initialView(), { job_id: "j", seq: 0, at: "2026-07-01T00:00:00.000Z", type: "stage_started", stage: "PROFILE" }),
      }),
    );
    expect(html).toContain('class="stage running">Profile<');
    expect(renderToStaticMarkup(createElement(UploadPage, { api }))).toContain("Analyze your business files");
  });
});
