// The viewer's API calls (interfaces §1). Events are read from the SSE endpoint with fetch (not EventSource), so a
// bearer token can be sent when the API requires one.
import type { JobEvent } from "@agentic-analytics/schema";

export interface Api {
  createJob(files: readonly File[], options: Record<string, unknown>): Promise<string>;
  follow(jobId: string, onEvent: (e: JobEvent) => void, signal?: AbortSignal): Promise<void>;
  metrics(jobId: string): Promise<{ yaml: string; metrics: { id: string; status: string; text: string }[] }>;
  confirm(jobId: string, yaml: string): Promise<void>;
  reportHtml(jobId: string): Promise<string>;
  jobs(): Promise<{ job_id: string; status: string; updated_at: string }[]>;
}

export function createApi(base = "", token?: string, f: typeof fetch = (u, i) => fetch(u, i)): Api {
  const call = async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (token) headers.set("authorization", `Bearer ${token}`);
    const res = await f(`${base}${path}`, { ...init, headers });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(body.error?.message ?? res.statusText);
    }
    return res;
  };
  return {
    async createJob(files, options) {
      const form = new FormData();
      for (const file of files) form.append("files[]", file);
      form.append("options", JSON.stringify(options));
      return ((await (await call("/v1/jobs", { method: "POST", body: form })).json()) as { job_id: string }).job_id;
    },
    async follow(jobId, onEvent, signal) {
      const res = await call(`/v1/jobs/${encodeURIComponent(jobId)}/events`, { ...(signal ? { signal } : {}) });
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        let i = buffer.indexOf("\n\n");
        while (i >= 0) {
          const data = buffer
            .slice(0, i)
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trimStart())
            .join("\n");
          buffer = buffer.slice(i + 2);
          if (data) onEvent(JSON.parse(data) as JobEvent);
          i = buffer.indexOf("\n\n");
        }
        if (done) return;
      }
    },
    async metrics(jobId) {
      return (await call(`/v1/jobs/${encodeURIComponent(jobId)}/metrics`)).json();
    },
    async confirm(jobId, yaml) {
      await call(`/v1/jobs/${encodeURIComponent(jobId)}/metrics`, {
        method: "POST",
        body: yaml,
        headers: { "content-type": "application/yaml" },
      });
    },
    async reportHtml(jobId) {
      return (await call(`/v1/jobs/${encodeURIComponent(jobId)}/report?format=html`)).text();
    },
    async jobs() {
      return (await call("/v1/jobs")).json();
    },
  };
}
