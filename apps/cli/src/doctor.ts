// `aa doctor` (docs/specs/interfaces.md §2): checks Node, DuckDB, model providers, SearXNG and Docling,
// and prints fixes. Only Node and DuckDB are required; every model provider and service is optional,
// because the engine builds and tests with FakeModel and in-process embeddings (AGENTS.md §2.9).

export type CheckStatus = "ok" | "missing" | "error";

export interface CheckResult {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail: string;
  readonly required: boolean;
  readonly fix?: string;
}

export type Env = Readonly<Record<string, string | undefined>>;

export interface DoctorDeps {
  readonly nodeVersion: string;
  readonly duckdbVersion: () => Promise<string>;
  readonly fetch: typeof fetch;
  readonly env: Env;
  readonly timeoutMs?: number;
}

const MIN_NODE_MAJOR = 22;

/** Free OpenAI-compatible endpoints probed when their key is set (docs/specs/models.md §3). */
export const OPENAI_COMPATIBLE_ENDPOINTS = [
  { id: "groq", baseUrl: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY" },
  { id: "openrouter", baseUrl: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY" },
] as const;

export async function runDoctor(deps: DoctorDeps): Promise<CheckResult[]> {
  const timeoutMs = deps.timeoutMs ?? 2000;
  const probe = (url: string, headers?: Record<string, string>) => probeUrl(deps.fetch, url, timeoutMs, headers);
  const ollamaUrl = trimSlash(deps.env.OLLAMA_BASE_URL ?? "http://localhost:11434");
  const searxngUrl = trimSlash(deps.env.SEARXNG_URL ?? "http://localhost:8888");
  const doclingUrl = trimSlash(deps.env.DOCLING_URL ?? "http://localhost:5001");

  const [duckdb, ollama, searxng, docling, ...openai] = await Promise.all([
    checkDuckdb(deps.duckdbVersion),
    checkOllama(ollamaUrl, probe),
    checkService("searxng", `${searxngUrl}/healthz`, probe, "optional web lane: docker compose --profile web up -d"),
    checkService("docling", `${doclingUrl}/health`, probe, "optional hard-PDF parser: docker compose --profile docling up -d"),
    ...OPENAI_COMPATIBLE_ENDPOINTS.map((e) => checkOpenAiCompatible(e, deps.env, probe)),
  ]);
  return [checkNode(deps.nodeVersion), duckdb, ollama, ...openai, searxng, docling];
}

export function checkNode(version: string): CheckResult {
  const major = Number.parseInt(version.replace(/^v/, "").split(".")[0] ?? "", 10);
  if (Number.isFinite(major) && major >= MIN_NODE_MAJOR) {
    return { name: "node", status: "ok", detail: version, required: true };
  }
  return { name: "node", status: "error", detail: `${version} (need >= ${MIN_NODE_MAJOR})`, required: true, fix: "install Node 22+" };
}

async function checkDuckdb(version: () => Promise<string>): Promise<CheckResult> {
  try {
    return { name: "duckdb", status: "ok", detail: await version(), required: true };
  } catch (err) {
    return { name: "duckdb", status: "error", detail: errorMessage(err), required: true, fix: "reinstall dependencies: bun install" };
  }
}

type Probe = (url: string, headers?: Record<string, string>) => Promise<ProbeResult>;
type ProbeResult = { ok: true; body: unknown } | { ok: false; reason: string };

async function checkOllama(baseUrl: string, probe: Probe): Promise<CheckResult> {
  const res = await probe(`${baseUrl}/api/tags`);
  if (!res.ok) {
    return {
      name: "ollama",
      status: "missing",
      detail: `not reachable at ${baseUrl} (${res.reason})`,
      required: false,
      fix: "optional: install Ollama and pull a tool-calling model, or set a free OpenAI-compatible key in .env",
    };
  }
  const models = modelNames(res.body, "models", "name");
  return {
    name: "ollama",
    status: "ok",
    detail: models.length ? `reachable, models: ${models.join(", ")}` : "reachable, no models pulled",
    required: false,
  };
}

async function checkOpenAiCompatible(endpoint: (typeof OPENAI_COMPATIBLE_ENDPOINTS)[number], env: Env, probe: Probe): Promise<CheckResult> {
  const name = `openai-compatible:${endpoint.id}`;
  const key = env[endpoint.keyEnv];
  if (!key) {
    return {
      name,
      status: "missing",
      detail: `${endpoint.keyEnv} not set`,
      required: false,
      fix: `optional: put a free ${endpoint.keyEnv} in .env`,
    };
  }
  const res = await probe(`${endpoint.baseUrl}/models`, { authorization: `Bearer ${key}` });
  if (!res.ok)
    return { name, status: "error", detail: `not reachable (${res.reason})`, required: false, fix: `check ${endpoint.keyEnv} and network` };
  const count = modelNames(res.body, "data", "id").length;
  return { name, status: "ok", detail: `reachable, ${count} model(s) listed`, required: false };
}

async function checkService(name: string, url: string, probe: Probe, fix: string): Promise<CheckResult> {
  const res = await probe(url);
  return res.ok
    ? { name, status: "ok", detail: `reachable at ${url}`, required: false }
    : { name, status: "missing", detail: `not reachable at ${url} (${res.reason})`, required: false, fix };
}

async function probeUrl(f: typeof fetch, url: string, timeoutMs: number, headers?: Record<string, string>): Promise<ProbeResult> {
  try {
    const res = await f(url, { signal: AbortSignal.timeout(timeoutMs), ...(headers ? { headers } : {}) });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    const text = await res.text();
    try {
      return { ok: true, body: JSON.parse(text) as unknown };
    } catch {
      return { ok: true, body: text };
    }
  } catch (err) {
    return { ok: false, reason: errorMessage(err) };
  }
}

function modelNames(body: unknown, listKey: string, nameKey: string): string[] {
  if (typeof body !== "object" || body === null) return [];
  const list = (body as Record<string, unknown>)[listKey];
  if (!Array.isArray(list)) return [];
  return list.flatMap((m: unknown) => {
    const v = typeof m === "object" && m !== null ? (m as Record<string, unknown>)[nameKey] : undefined;
    return typeof v === "string" ? [v] : [];
  });
}

export function formatReport(results: readonly CheckResult[]): string {
  const icon: Record<CheckStatus, string> = { ok: "✓", missing: "–", error: "✗" };
  const width = Math.max(...results.map((r) => r.name.length));
  const lines = ["agentic-analytics doctor", ""];
  for (const r of results) {
    lines.push(`  ${icon[r.status]} ${r.name.padEnd(width)}  ${r.detail}`);
    if (r.fix && r.status !== "ok") lines.push(`    ${" ".repeat(width)}  fix: ${r.fix}`);
  }
  const providers = results.filter((r) => r.name === "ollama" || r.name.startsWith("openai-compatible:"));
  const reachable = providers.filter((r) => r.status === "ok").map((r) => r.name);
  lines.push("");
  lines.push(
    reachable.length
      ? `Model providers reachable: ${reachable.join(", ")}`
      : "Model providers reachable: none. That's fine for building and tests (FakeModel); real runs need one.",
  );
  return `${lines.join("\n")}\n`;
}

/** 1 only when a required check fails; optional services never fail the doctor. */
export function exitCode(results: readonly CheckResult[]): 0 | 1 {
  return results.some((r) => r.required && r.status !== "ok") ? 1 : 0;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.cause instanceof Error ? `${err.message}: ${err.cause.message}` : err.message;
  return String(err);
}
