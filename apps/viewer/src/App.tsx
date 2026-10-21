// The viewer (interfaces §5): upload → live progress (stages light up as they run) → metric confirmation →
// the embedded report. Hash routes keep it a static bundle that `aa serve` can host at `/`.
import type { JobEvent } from "@agentic-analytics/schema";
import { type FormEvent, useEffect, useMemo, useReducer, useState } from "react";
import { type Api, ApiError, createApi, errorText } from "./api.ts";
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

/** Asks for the API token after a 401 and keeps it in this browser (`aa-token`), then reloads with it. */
export function TokenForm() {
  const [token, setToken] = useState("");
  const [blocked, setBlocked] = useState(false);
  const save = (e: FormEvent) => {
    e.preventDefault();
    try {
      localStorage.setItem("aa-token", token.trim());
    } catch {
      // Storage is blocked (a private window): the token can't be kept, so say so instead of reloading in a loop.
      setBlocked(true);
      return;
    }
    location.reload();
  };
  return (
    <form onSubmit={save} className="token">
      <label>
        API token
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
      </label>
      <button type="submit" disabled={!token.trim()}>
        Save and reload
      </button>
      {blocked ? <p className="error">This browser won't store the token; allow site data for this page.</p> : null}
    </form>
  );
}

/** A failed call, said in the page; a 401 also offers the token field. */
export function Failure({ error }: { error: unknown }) {
  return (
    <>
      <p className="error">{errorText(error)}</p>
      {error instanceof ApiError && error.status === 401 ? <TokenForm /> : null}
    </>
  );
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
  const [listError, setListError] = useState<unknown>();
  useEffect(() => {
    api.jobs().then(setJobs, setListError);
  }, [api]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    try {
      const id = await api.createJob(files, { auto_confirm: !review, web, ...(objective ? { objective } : {}) });
      location.hash = `#/jobs/${id}`;
    } catch (err) {
      setError(errorText(err));
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
      {listError ? <Failure error={listError} /> : null}
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

export function JobPage({ api, jobId }: { api: Api; jobId: string }) {
  const [view, dispatch] = useReducer(reduce, undefined, initialView);
  const [html, setHtml] = useState<string>();
  const [round, setRound] = useState(0);
  // A stream or report that fails is shown, not swallowed: a frozen all-pending pipeline says nothing.
  const [failure, setFailure] = useState<unknown>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `round` re-opens the event stream after a confirmation resumes the job
  useEffect(() => {
    const ctl = new AbortController();
    setFailure(undefined);
    let ended = false;
    api
      .follow(
        jobId,
        (e: JobEvent) => {
          if (e.type === "done" || e.type === "failed" || e.type === "awaiting_confirmation") ended = true;
          dispatch(e);
        },
        ctl.signal,
      )
      .then(
        // A stream that closes before the job reaches a stopping point would leave the page "running" forever.
        () => {
          if (!ended && !ctl.signal.aborted)
            setFailure(new Error("The event stream ended before the job finished. Reload to follow it again."));
        },
        (err: unknown) => {
          if (!ctl.signal.aborted) setFailure(err);
        },
      );
    return () => ctl.abort();
  }, [api, jobId, round]);
  useEffect(() => {
    if (view.phase === "done") api.reportHtml(jobId).then(setHtml, setFailure);
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
      {failure ? <Failure error={failure} /> : null}
      {view.phase === "awaiting_confirmation" ? <MetricsForm api={api} jobId={jobId} onConfirmed={() => setRound((r) => r + 1)} /> : null}
      {html ? <iframe title="report" className="report" srcDoc={html} sandbox="allow-scripts" /> : null}
    </section>
  );
}

export function MetricsForm({ api, jobId, onConfirmed }: { api: Api; jobId: string; onConfirmed: () => void }) {
  const [data, setData] = useState<{ yaml: string; metrics: { id: string; text: string }[] }>();
  const [yaml, setYaml] = useState("");
  const [error, setError] = useState<string>();
  const [loadError, setLoadError] = useState<unknown>();
  useEffect(() => {
    api.metrics(jobId).then((m) => {
      setData(m);
      setYaml(m.yaml);
    }, setLoadError);
  }, [api, jobId]);
  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.confirm(jobId, yaml);
      onConfirmed();
    } catch (err) {
      setError(errorText(err));
    }
  };
  if (loadError) return <Failure error={loadError} />;
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
