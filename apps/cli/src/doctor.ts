// `aa doctor` (docs/specs/interfaces.md §2): checks Node, DuckDB, model providers, SearXNG and Docling,
// prints fixes, and calls each role's model (planner, extractor, judge) with a one-line prompt when its provider
// is up. `--models` lists the model ids each reachable provider serves, to pick exact ids for the role settings.
// Only Node and DuckDB are required; everything else is optional, because the engine builds and tests
// with FakeModel and in-process embeddings (AGENTS.md §2.9).

import { describeRoleModel, type ModelClient, ModelError, type Role, resolveModelConfig } from "@agentic-analytics/models";
import type { Config } from "@agentic-analytics/schema";
import { z } from "zod";

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
  /** Builds the client used for the one-line model call; tests inject FakeModel. */
  readonly modelClient: (config: Config) => ModelClient;
  /** Parsed agentic-analytics.config.yaml, if present. */
  readonly configFile?: unknown;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  /** The roles whose model gets the one-line call (default all three; the serve health check calls the planner only). */
  readonly roles?: readonly Role[];
  /** List every model id a reachable provider serves (`aa doctor --models`). */
  readonly listModels?: boolean;
}

const ROLES: readonly Role[] = ["planner", "extractor", "judge"];

const MIN_NODE_MAJOR = 22;

export async function runDoctor(deps: DoctorDeps): Promise<CheckResult[]> {
  // 10 s: OpenRouter's /models answers with every model it serves (hundreds), which takes about 4 s.
  const timeoutMs = deps.timeoutMs ?? 10_000;
  const probe: Probe = (url, headers) => probeUrl(deps.fetch, url, timeoutMs, headers);
  const searxngUrl = trimSlash(deps.env.SEARXNG_URL ?? "http://localhost:8888");
  const doclingUrl = trimSlash(deps.env.DOCLING_URL ?? "http://localhost:5001");

  let config: Config | undefined;
  let configError: CheckResult | undefined;
  try {
    config = resolveModelConfig(deps.env, deps.configFile);
  } catch (err) {
    configError = {
      name: "model config",
      status: "error",
      detail: errorMessage(err),
      required: false,
      fix: "fix PLANNER_MODEL/EXTRACTOR_MODEL/JUDGE_MODEL or agentic-analytics.config.yaml",
    };
  }

  const ollamaUrl = trimSlash(config?.providers.ollama?.base_url ?? "http://localhost:11434");
  const endpoints = Object.entries(config?.providers["openai-compatible"] ?? {});
  const [duckdb, ollama, searxng, docling, ...openai] = await Promise.all([
    checkDuckdb(deps.duckdbVersion),
    checkOllama(ollamaUrl, probe),
    checkService("searxng", `${searxngUrl}/healthz`, probe, "optional web lane: docker compose --profile web up -d"),
    checkService("docling", `${doclingUrl}/health`, probe, "optional hard-PDF parser: docker compose --profile docling up -d"),
    ...endpoints.map(([id, e]) => checkOpenAiCompatible(id, e.base_url, e.api_key_env, deps.env, probe, deps.listModels ?? false)),
  ]);
  const providers = [ollama, ...openai];
  const calls = config
    ? await Promise.all((deps.roles ?? ROLES).map((role) => checkModelCall(config, role, providers, deps)))
    : configError
      ? [configError]
      : [];
  return [checkNode(deps.nodeVersion), duckdb, ...providers, ...calls, searxng, docling];
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

async function checkOpenAiCompatible(
  id: string,
  baseUrl: string,
  keyEnv: string | undefined,
  env: Env,
  probe: Probe,
  listModels: boolean,
): Promise<CheckResult> {
  const name = `openai-compatible:${id}`;
  const key = keyEnv ? env[keyEnv] : undefined;
  if (keyEnv && !key) {
    return { name, status: "missing", detail: `${keyEnv} not set`, required: false, fix: `optional: put a free ${keyEnv} in .env` };
  }
  const res = await probe(`${trimSlash(baseUrl)}/models`, key ? { authorization: `Bearer ${key}` } : undefined);
  if (!res.ok)
    return {
      name,
      status: "error",
      detail: `not reachable (${res.reason})`,
      required: false,
      fix: keyEnv ? `check ${keyEnv} and network` : "check the base_url",
    };
  const ids = modelNames(res.body, "data", "id");
  const detail =
    listModels && ids.length
      ? `reachable, ${ids.length} model(s): ${[...ids].sort().join(", ")}`
      : `reachable, ${ids.length} model(s) listed`;
  return { name, status: "ok", detail, required: false };
}

/**
 * The one-line prompt (ROADMAP M1) for one role: only attempted when the role's provider answered its probe. The
 * planner's line keeps the name "model call" (the serve health check reports it under that name).
 */
async function checkModelCall(config: Config, role: Role, providers: readonly CheckResult[], deps: DoctorDeps): Promise<CheckResult> {
  const m = config.models[role];
  const label = describeRoleModel(m);
  const name = role === "planner" ? "model call" : `model call (${role})`;
  const providerCheck = m.provider === "ollama" ? "ollama" : `openai-compatible:${m.endpoint}`;
  const up = providers.find((p) => p.name === providerCheck)?.status === "ok";
  if (!up) {
    return {
      name,
      status: "missing",
      detail: `skipped: ${role} ${label} — ${providerCheck} not reachable`,
      required: false,
      fix: `optional: start the ${role}'s provider, or set ${role.toUpperCase()}_MODEL to a reachable one`,
    };
  }
  const now = deps.now ?? (() => performance.now());
  const started = now();
  try {
    const { object } = await deps.modelClient(config).generateObject({
      role,
      schema: z.object({ reply: z.string() }),
      system: "You are a health check. Answer with JSON only.",
      prompt: 'Reply with {"reply": "OK"}.',
      maxRetries: 1,
    });
    const seconds = ((now() - started) / 1000).toFixed(1);
    return {
      name,
      status: "ok",
      detail: `${role} ${label} replied "${object.reply.slice(0, 40)}" in ${seconds}s`,
      required: false,
    };
  } catch (err) {
    const code = err instanceof ModelError ? `${err.code}: ` : "";
    return {
      name,
      status: "error",
      detail: `${role} ${label} failed (${code}${errorMessage(err)})`,
      required: false,
      fix: "check that the model is pulled/available and supports JSON output",
    };
  }
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
