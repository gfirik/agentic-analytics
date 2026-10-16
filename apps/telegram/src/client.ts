// A small client for the HTTP API (interfaces §1): the Telegram bot talks to the engine only through it, as a
// remote user would. `fetch` is injectable so tests can point it at an in-process app.
import type { JobEvent, Report } from "@agentic-analytics/schema";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions {
  readonly baseUrl: string;
  readonly token?: string;
  readonly fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface JobOptionsInput {
  readonly objective?: string;
  readonly auto_confirm?: boolean;
  readonly web?: boolean;
  readonly currency?: string;
}

export class ApiClient {
  private readonly f: (url: string, init?: RequestInit) => Promise<Response>;
  constructor(private readonly o: ApiClientOptions) {
    this.f = o.fetch ?? ((u, i) => fetch(u, i));
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.o.token) headers.set("authorization", `Bearer ${this.o.token}`);
    const res = await this.f(`${this.o.baseUrl.replace(/\/$/, "")}${path}`, { ...init, headers });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      throw new ApiError(body.error?.code ?? "HTTP", body.error?.message ?? res.statusText, res.status);
    }
    return res;
  }

  async createJob(files: readonly { name: string; bytes: Uint8Array }[], options: JobOptionsInput): Promise<string> {
    const form = new FormData();
    for (const f of files) form.append("files[]", new File([f.bytes as Uint8Array<ArrayBuffer>], f.name));
    form.append("options", JSON.stringify(options));
    const body = (await (await this.call("/v1/jobs", { method: "POST", body: form })).json()) as { job_id: string };
    return body.job_id;
  }

  /** Reads the job's SSE stream to its end, calling `onEvent` for each event; returns the last one. */
  async follow(jobId: string, onEvent: (e: JobEvent) => void | Promise<void>): Promise<JobEvent | undefined> {
    const res = await this.call(`/v1/jobs/${encodeURIComponent(jobId)}/events`, { headers: { accept: "text/event-stream" } });
    const reader = res.body?.getReader();
    if (!reader) return undefined;
    const decoder = new TextDecoder();
    let buffer = "";
    let last: JobEvent | undefined;
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      let i = buffer.indexOf("\n\n");
      while (i >= 0) {
        const block = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        const data = block
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (data) {
          last = JSON.parse(data) as JobEvent;
          await onEvent(last);
        }
        i = buffer.indexOf("\n\n");
      }
      if (done) return last;
    }
  }

  async report(jobId: string): Promise<Report> {
    return (await (
      await this.call(`/v1/jobs/${encodeURIComponent(jobId)}/report`, { headers: { accept: "application/json" } })
    ).json()) as Report;
  }

  async reportHtml(jobId: string): Promise<string> {
    return (await this.call(`/v1/jobs/${encodeURIComponent(jobId)}/report?format=html`)).text();
  }
}
