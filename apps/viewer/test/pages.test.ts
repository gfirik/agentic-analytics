// @vitest-environment happy-dom
// The job page and the metrics form in a DOM, with a fake Api: failures are shown (a 401 asks for the token), and a
// confirmation re-opens the event stream.
import type { ConfirmView, JobEvent } from "@agentic-analytics/schema";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobPage, MetricsForm } from "../src/App.tsx";
import { type Api, ApiError } from "../src/index.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const base = { job_id: "j", at: "2026-07-01T00:00:00.000Z" };
/** A confirm screen as the API sends it: one table with an unit-cost column, one metric. */
const screen = (over: Partial<ConfirmView> = {}): ConfirmView => ({
  yaml: "version: 1\ngrain: month\nmetrics: []\n",
  metrics_yaml: "version: 1\ngrain: month\nmetrics: []\n",
  metrics: [{ id: "revenue", status: "assumed", text: "Revenue: sum of amount" }],
  roles: [
    {
      table: "t_t1",
      table_id: "T1",
      column: "std_cost",
      label: "Std cost",
      role: "unit_cost",
      status: "assumed",
      source: "detector",
      evidence: ['header is "std cost"', "the margin identity holds on 100% of rows"],
    },
    {
      table: "t_t1",
      table_id: "T1",
      column: "amount",
      label: "Amount",
      role: "amount",
      status: "assumed",
      source: "detector",
      evidence: [],
    },
  ],
  columns_without_role: [],
  table_kinds: [{ table: "t_t1", table_id: "T1", kind: "sales_lines", evidence: ["transaction_date", "amount"] }],
  business_model: { model: "wholesale", status: "assumed", signals: ["a few customers hold most of the revenue"] },
  vocabulary: ["amount", "unit_cost", "measure", "none"],
  business_models: ["retail", "wholesale", "unknown"],
  ...over,
});
const fakeApi = (over: Partial<Api>): Api => ({
  createJob: async () => "j",
  follow: async () => {},
  metrics: async () => screen(),
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

describe("JobPage: a stream that ends early", () => {
  it("says so instead of staying on running", async () => {
    const api = fakeApi({ follow: async (_id, on) => on({ ...base, seq: 0, type: "stage_started", stage: "INGEST" } as JobEvent) });
    const page = await render(createElement(JobPage, { api, jobId: "j" }));
    await vi.waitFor(() => expect(page.textContent).toContain("The event stream ended before the job finished."));
  });
});

describe("MetricsForm: one screen for roles and metrics", () => {
  const select = (form: HTMLElement, label: string) => form.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  const change = (el: HTMLSelectElement, value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(el, value);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });

  it("shows the roles with their evidence and status, the table kinds, the business model and the metrics", async () => {
    const form = await render(createElement(MetricsForm, { api: fakeApi({}), jobId: "j", onConfirmed: () => {} }));
    await vi.waitFor(() => expect(form.querySelector("table.roles")).not.toBeNull());
    const cells = [...form.querySelectorAll("table.roles tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => (td.querySelector("select") ? "" : td.textContent)),
    );
    expect(cells[0]).toEqual(["t_t1.Std cost", "", "assumed", 'header is "std cost"; the margin identity holds on 100% of rows']);
    expect(select(form, "Role of t_t1.Std cost").value).toBe("unit_cost");
    expect(form.textContent).toContain("t_t1: sales_lines (from transaction_date, amount)");
    expect(select(form, "Business model").value).toBe("wholesale");
    expect(form.textContent).toContain("Revenue: sum of amount");
    // the roles come before the metrics on the page
    expect(form.textContent?.indexOf("Column roles")).toBeLessThan(form.textContent?.indexOf("Revenue: sum of amount") ?? 0);
  });

  it("changing a role enables the update, which posts the roles alone and shows the metrics drafted from them", async () => {
    const posted: string[] = [];
    let drafted = false;
    const api = fakeApi({
      confirm: async (_id, yaml) => {
        posted.push(yaml);
        drafted = true;
      },
      metrics: async () => (drafted ? screen({ metrics: [{ id: "cost", status: "assumed", text: "Cost: sum of std_cost" }] }) : screen()),
    });
    const form = await render(createElement(MetricsForm, { api, jobId: "j", onConfirmed: () => {} }));
    await vi.waitFor(() => expect(form.querySelector("table.roles")).not.toBeNull());
    const update = [...form.querySelectorAll("button")].find((b) => b.textContent === "Update the drafts") as HTMLButtonElement;
    const confirm = [...form.querySelectorAll("button")].find((b) => b.textContent === "Confirm and continue") as HTMLButtonElement;
    expect(update.disabled).toBe(true);
    await change(select(form, "Role of t_t1.Std cost"), "measure");
    expect(update.disabled).toBe(false);
    // confirming waits until the drafts follow the roles
    expect(confirm.disabled).toBe(true);
    await act(async () => update.click());
    expect(posted).toEqual([
      'version: 1\nroles: [{"table":"t_t1","column":"std_cost","role":"measure"},{"table":"t_t1","column":"amount","role":"amount"}]\nbusiness_model: {"model":"wholesale"}\n',
    ]);
    await vi.waitFor(() => expect(form.textContent).toContain("Cost: sum of std_cost"));
  });

  it("confirming posts the metrics with every role on the screen, as YAML", async () => {
    const posted: string[] = [];
    let done = false;
    const api = fakeApi({ confirm: async (_id, yaml) => void posted.push(yaml) });
    const form = await render(createElement(MetricsForm, { api, jobId: "j", onConfirmed: () => (done = true) }));
    await vi.waitFor(() => expect(form.querySelector("textarea")).not.toBeNull());
    await act(async () => form.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(done).toBe(true);
    expect(posted[0]).toBe(
      'version: 1\ngrain: month\nmetrics: []\nroles: [{"table":"t_t1","column":"std_cost","role":"unit_cost"},{"table":"t_t1","column":"amount","role":"amount"}]\nbusiness_model: {"model":"wholesale"}\n',
    );
  });

  it("an unknown role refused by the API is shown", async () => {
    const api = fakeApi({ confirm: () => Promise.reject(new ApiError(400, "UNKNOWN_ROLE", '"wizard" is not a role of the vocabulary')) });
    const form = await render(createElement(MetricsForm, { api, jobId: "j", onConfirmed: () => {} }));
    await vi.waitFor(() => expect(form.querySelector("textarea")).not.toBeNull());
    await act(async () => form.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(form.textContent).toContain('"wizard" is not a role of the vocabulary');
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
