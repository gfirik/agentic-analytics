// @vitest-environment happy-dom
// The job page and the metrics form in a DOM, with a fake Api: failures are shown (a 401 asks for the token), and a
// confirmation re-opens the event stream.
import type { JobEvent } from "@agentic-analytics/schema";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobPage, MetricsForm } from "../src/App.tsx";
import { type Api, ApiError } from "../src/index.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base = { job_id: "j", at: "2026-07-01T00:00:00.000Z" };
const fakeApi = (over: Partial<Api>): Api => ({
  createJob: async () => "j",
  follow: async () => {},
  metrics: async () => ({ yaml: "metrics: []", metrics: [{ id: "revenue", status: "draft", text: "Revenue: sum of amount" }] }),
  confirm: async () => {},
  reportHtml: async () => "<!doctype html><p>report</p>",
  jobs: async () => [],
  ...over,
});

let root: Root | undefined;
let host: HTMLElement | undefined;
function cleanup() {
  const r = root;
  root = undefined;
  if (r) act(() => r.unmount());
  host?.remove();
}
afterEach(cleanup);
async function render(el: ReturnType<typeof createElement>): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(el));
  return host;
}

describe("JobPage", () => {
  it("a 401 on the event stream says a token is needed and offers the token field", async () => {
    const api = fakeApi({ follow: () => Promise.reject(new ApiError(401, "UNAUTHORIZED", "missing or wrong bearer token")) });
    const page = await render(createElement(JobPage, { api, jobId: "j" }));
    expect(page.textContent).toContain("This API needs a token. Paste it below.");
    expect(page.querySelector('input[type="password"]')).not.toBeNull();
  });

  it("any other stream failure is said in the page, and a failed report too", async () => {
    const down = await render(
      createElement(JobPage, { api: fakeApi({ follow: () => Promise.reject(new Error("network down")) }), jobId: "j" }),
    );
    expect(down.textContent).toContain("network down");
    cleanup();
    const api = fakeApi({
      follow: async (_id, on) => on({ ...base, seq: 0, type: "done" } as JobEvent),
      reportHtml: () => Promise.reject(new ApiError(404, "NOT_FOUND", "job j has no report")),
    });
    const page = await render(createElement(JobPage, { api, jobId: "j" }));
    await vi.waitFor(() => expect(page.textContent).toContain("job j has no report"));
  });

  it("confirming the metrics re-opens the event stream", async () => {
    let follows = 0;
    const api = fakeApi({
      follow: async (_id, on) => {
        follows++;
        on({ ...base, seq: follows, type: follows === 1 ? "awaiting_confirmation" : "done" } as JobEvent);
      },
    });
    const page = await render(createElement(JobPage, { api, jobId: "j" }));
    await vi.waitFor(() => expect(page.querySelector("textarea")).not.toBeNull());
    await act(async () => page.querySelector("form.metrics")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await vi.waitFor(() => expect(follows).toBe(2));
    await vi.waitFor(() => expect(page.querySelector("iframe")).not.toBeNull());
  });
});

describe("MetricsForm", () => {
  it("a failed load is shown instead of loading forever; a refused edit shows the API's message", async () => {
    const failed = await render(
      createElement(MetricsForm, { api: fakeApi({ metrics: () => Promise.reject(new Error("BUSY")) }), jobId: "j", onConfirmed: () => {} }),
    );
    expect(failed.textContent).toContain("BUSY");
    expect(failed.textContent).not.toContain("Loading");
    cleanup();
    const api = fakeApi({ confirm: () => Promise.reject(new ApiError(400, "BAD_REQUEST", "revenue: unknown column amt")) });
    const form = await render(createElement(MetricsForm, { api, jobId: "j", onConfirmed: () => {} }));
    await vi.waitFor(() => expect(form.querySelector("textarea")).not.toBeNull());
    await act(async () => form.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(form.textContent).toContain("revenue: unknown column amt");
  });
});
