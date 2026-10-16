// The viewer (interfaces §5): upload → live progress (stages light up as they run) → metric confirmation →
// the embedded report. Hash routes keep it a static bundle that `aa serve` can host at `/`.
import type { JobEvent } from "@agentic-analytics/schema";
import { type FormEvent, useEffect, useMemo, useReducer, useState } from "react";
import { type Api, createApi } from "./api.ts";
import { initialView, type JobView, reduce, STAGES } from "./state.ts";

const LABELS: Record<string, string> = {
  INGEST: "Read files",
  PROFILE: "Profile",
  METRICS_DRAFT: "Draft metrics",
  AWAIT_CONFIRM: "Confirm metrics",
  MEASURE: "Measure",
  DETECT: "Detect",
  DECOMPOSE: "Decompose",
  INDEX_DOCS: "Read documents",
  WEB_CONTEXT: "Web context",
  EXPLAIN: "Explain",
  DECIDE: "Decide",
  VERIFY: "Verify",
  RENDER: "Report",
};

function useRoute(): string {
  const [hash, setHash] = useState(() => (typeof location === "undefined" ? "" : location.hash));
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash;
}

function tokenFromStorage(): string | undefined {
  try {
    return localStorage.getItem("aa-token") ?? undefined;
  } catch {
    return undefined;
  }
}

export function App() {
  const route = useRoute();
  const api = useMemo(() => createApi("", tokenFromStorage()), []);
  const job = /^#\/jobs\/([\w-]+)/.exec(route)?.[1];
  return (
    <main>
      <header>
        <a href="#/">agentic-analytics</a>
        <span className="muted">files in, a verified report out</span>
      </header>
      {job ? <JobPage api={api} jobId={job} /> : <UploadPage api={api} />}
    </main>
  );
}

export function UploadPage({ api }: { api: Api }) {
  const [files, setFiles] = useState<File[]>([]);
  const [objective, setObjective] = useState("");
  const [review, setReview] = useState(true);
  const [web, setWeb] = useState(false);
  const [error, setError] = useState<string>();
  const [jobs, setJobs] = useState<{ job_id: string; status: string }[]>([]);
  useEffect(() => {
    api.jobs().then(setJobs, () => setJobs([]));
  }, [api]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    try {
      const id = await api.createJob(files, { auto_confirm: !review, web, ...(objective ? { objective } : {}) });
      location.hash = `#/jobs/${id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <section>
      <h1>Analyze your business files</h1>
      <form onSubmit={submit}>
        <label className="drop">
          <input type="file" multiple onChange={(e) => setFiles([...(e.target.files ?? [])])} />
          {files.length
            ? `${files.length} file(s): ${files.map((f) => f.name).join(", ")}`
            : "Choose spreadsheets, CSV, PDF, Word or email files"}
        </label>
        <label>
          Objective (optional)
          <input value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Grow profit" />
        </label>
        <label className="check">
          <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} /> Review metric definitions before the
          analysis
        </label>
        <label className="check">
          <input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} /> Allow sanitized web searches for context
        </label>
        <button type="submit" disabled={!files.length}>
          Start
        </button>
        {error ? <p className="error">{error}</p> : null}
      </form>
      {jobs.length ? (
        <>
          <h2>Jobs</h2>
          <ul>
            {jobs.map((j) => (
              <li key={j.job_id}>
                <a href={`#/jobs/${j.job_id}`}>{j.job_id}</a> <span className="muted">{j.status}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

export function Pipeline({ view }: { view: JobView }) {
  return (
    <ol className="pipeline">
      {STAGES.map((s) => (
        <li key={s} className={`stage ${view.stages[s]}`}>
          {LABELS[s] ?? s}
        </li>
      ))}
    </ol>
  );
}

function JobPage({ api, jobId }: { api: Api; jobId: string }) {
  const [view, dispatch] = useReducer(reduce, undefined, initialView);
  const [html, setHtml] = useState<string>();
  const [round, setRound] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    api.follow(jobId, (e: JobEvent) => dispatch(e), ctl.signal).catch(() => undefined);
    return () => ctl.abort();
  }, [api, jobId, round]);
  useEffect(() => {
    if (view.phase === "done") api.reportHtml(jobId).then(setHtml, () => undefined);
  }, [api, jobId, view.phase]);
  return (
    <section>
      <h1>Job {jobId}</h1>
      <Pipeline view={view} />
      {view.message && view.phase === "running" ? <p className="muted">{view.message}</p> : null}
      {view.warnings.map((w) => (
        <p key={w} className="warning">
          {w}
        </p>
      ))}
      {view.phase === "failed" ? <p className="error">{view.error}</p> : null}
      {view.phase === "awaiting_confirmation" ? <MetricsForm api={api} jobId={jobId} onConfirmed={() => setRound((r) => r + 1)} /> : null}
      {html ? <iframe title="report" className="report" srcDoc={html} sandbox="allow-scripts" /> : null}
    </section>
  );
}

function MetricsForm({ api, jobId, onConfirmed }: { api: Api; jobId: string; onConfirmed: () => void }) {
  const [data, setData] = useState<{ yaml: string; metrics: { id: string; text: string }[] }>();
  const [yaml, setYaml] = useState("");
  const [error, setError] = useState<string>();
  useEffect(() => {
    api.metrics(jobId).then(
      (m) => {
        setData(m);
        setYaml(m.yaml);
      },
      (e: unknown) => setError(String(e)),
    );
  }, [api, jobId]);
  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.confirm(jobId, yaml);
      onConfirmed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  if (!data) return <p className="muted">Loading the drafted metrics…</p>;
  return (
    <form onSubmit={confirm} className="metrics">
      <h2>Confirm the metric definitions</h2>
      <p className="muted">
        Every number in the report is computed from these. Edit the YAML to change one, or delete an entry to drop it.
      </p>
      <ul>
        {data.metrics.map((m) => (
          <li key={m.id}>{m.text}</li>
        ))}
      </ul>
      <textarea value={yaml} onChange={(e) => setYaml(e.target.value)} rows={18} spellCheck={false} />
      <button type="submit">Confirm and continue</button>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}
