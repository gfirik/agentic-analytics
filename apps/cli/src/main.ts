import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger, type JobDeps, JobManager, type JobOptions, jsonLines } from "@agentic-analytics/core";
import { coffeePlanner } from "@agentic-analytics/core/testing";
import { evalCommand, evalMatrix, goldenEvalCommand, realEvalCommand } from "@agentic-analytics/eval-runner";
import { mcpHttpHandler, serveStdio } from "@agentic-analytics/mcp";
import type { ReviewChoice, ReviewIO } from "@agentic-analytics/metrics";
import {
  type CallRecord,
  createModelClient,
  dailyTokenLimit,
  describeRoleModel,
  fileCache,
  type ModelClient,
  ModelError,
  profileFor,
  Router,
  resolveModelConfig,
} from "@agentic-analytics/models";
import { hashEmbedder, transformersEmbedder } from "@agentic-analytics/retrieval";
import { ServeError, startServer } from "@agentic-analytics/server";
import { duckdbVersion } from "@agentic-analytics/store";
import { searxngProvider } from "@agentic-analytics/web";
import { defineCommand, runMain } from "citty";
import { parse } from "yaml";
import { analyzeCommand, type ReviewPrompt } from "./analyze.ts";
import { collectPaths } from "./collect.ts";
import { exitCode, formatReport, runDoctor } from "./doctor.ts";
import { nightlyArgs } from "./eval-args.ts";
import { askCommand, explainCommand, jobsList } from "./followup.ts";
import { runMetricsCommand } from "./metrics.ts";
import { lineReader } from "./prompt.ts";
import { formatEvent, runCommand } from "./run.ts";
import { embedderChoice, isStandalone, onlyIds, onlyProblem, replayProblem, resultsLocation, runtimeVersion } from "./standalone.ts";
import { UsageError, usageCommand } from "./usage.ts";

// The CLI reads .env like the server will; values stay in process.env and are never printed.
if (existsSync(".env")) process.loadEnvFile(".env");
const CONFIG_FILE = "agentic-analytics.config.yaml";
const configFile = () => (existsSync(CONFIG_FILE) ? (parse(readFileSync(CONFIG_FILE, "utf8")) as unknown) : undefined);

const doctor = defineCommand({
  meta: {
    name: "doctor",
    description: "Check Node, DuckDB, model providers, SearXNG and Docling; call each role's model once",
  },
  args: { models: { type: "boolean", description: "List the model ids each reachable provider serves" } },
  async run({ args }) {
    const file = configFile();
    const results = await runDoctor({
      nodeVersion: runtimeVersion(process.env, process.versions, process.version),
      duckdbVersion,
      fetch: globalThis.fetch,
      env: process.env,
      modelClient: (config) => createModelClient(config, { env: process.env, onCall: logCall }),
      ...(file !== undefined ? { configFile: file } : {}),
      ...(args.models ? { listModels: true } : {}),
    });
    process.stdout.write(formatReport(results));
    process.exitCode = exitCode(results);
  },
});

const ENGINE_VERSION = "0.0.0";
const jobsRoot = () => process.env.AA_JOBS_DIR ?? join("data", "jobs");
const print = (l: string) => process.stdout.write(`${l}\n`);
/** Unexpected server and MCP errors: the full detail goes to stderr, the caller gets a generic message. */
const logInternal = (err: unknown) =>
  process.stderr.write(`internal error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);

/**
 * Every model call, with the provider and model that served it (M13a): appended to data/logs/model-calls.jsonl,
 * and echoed to stderr when AA_LOG_CALLS is set. No prompt or answer text is logged.
 */
function logCall(c: CallRecord): void {
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...c })}\n`;
  try {
    mkdirSync(join("data", "logs"), { recursive: true });
    appendFileSync(join("data", "logs", "model-calls.jsonl"), line);
  } catch {
    // Logging must never stop a job (a read-only folder, for example).
  }
  if (process.env.AA_LOG_CALLS) process.stderr.write(line);
}

/** The embedder for a run: see embedderChoice (standalone.ts) for the binary's default. */
function pickEmbedder(arg: string | undefined, configured: string, cacheDir: string) {
  const choice = embedderChoice(arg, process.env);
  if (choice.kind === "hash") {
    if (choice.notice) process.stderr.write(`${choice.notice}\n`);
    return hashEmbedder();
  }
  return transformersEmbedder({ model: choice.model ?? configured, cacheDir });
}

/** Where transformers models are cached (AA_MODELS_DIR, else the user cache). */
const modelsDir = () => process.env.AA_MODELS_DIR ?? join(homedir(), ".cache", "agentic-analytics", "models");

/** The self-hosted SearXNG search provider (docker compose --profile web up -d searxng). */
const searxng = () =>
  searxngProvider({
    baseUrl: process.env.SEARXNG_URL ?? "http://localhost:8888",
    ...(process.env.SEARXNG_ENGINES ? { engines: process.env.SEARXNG_ENGINES } : {}),
  });

/** Models, embedder and web lane from the environment and config file, as every door uses them. */
function runtime(embedderArg?: string) {
  const config = resolveModelConfig(process.env, configFile());
  // AA_DEMO_MODEL=scripted: the scripted coffee-roaster planner (no LLM), for the deterministic README demo only.
  const scripted = process.env.AA_DEMO_MODEL === "scripted";
  if (scripted) process.stderr.write("Scripted demo model (no LLM): a deterministic replay for examples/coffee-roaster.\n");
  const model: ModelClient = scripted
    ? coffeePlanner()
    : createModelClient(config, {
        env: process.env,
        onCall: logCall,
        ...(process.env.AA_MODEL_CACHE ? { cache: fileCache(process.env.AA_MODEL_CACHE) } : {}),
      });
  const embedder = pickEmbedder(embedderArg, config.models.embedder.model, modelsDir());
  const plannerProfile = profileFor(describeRoleModel(config.models.planner));
  const engine = {
    version: ENGINE_VERSION,
    // The report's provenance names the scripted planner when it ran, never a model that wasn't called.
    models: (["planner", "extractor", "judge"] as const).map((role) =>
      scripted
        ? { role, provider: "scripted", model: "coffee-roaster demo planner (no LLM)" }
        : { role, provider: config.models[role].provider, model: config.models[role].model },
    ),
  };
  const web = () => ({ provider: searxng() });
  const deps = (o: JobOptions, log?: boolean): JobDeps => ({
    model,
    embedder,
    engine,
    ...(o.web ? { web: web() } : {}),
    ...(log ? { log: createLogger(jsonLines((l) => process.stderr.write(l))) } : {}),
  });
  const smallModel = plannerProfile?.smallModel === true;
  // Defaults live in the manager so every door (CLI, API, MCP, Telegram) runs the same job for the same files.
  const manager = (log?: boolean) =>
    new JobManager({ root: jobsRoot(), model, deps: (o) => deps(o, log), ...(smallModel ? { defaults: { smallModel: true } } : {}) });
  return { config, model, embedder, engine, web, manager };
}

/** Terminal review: one letter per choice; edits are YAML typed or pasted, ended by an empty line. */
function terminalIO(): ReviewIO & { close(): void } {
  const rl = lineReader(process.stdin, process.stdout);
  const keys: Record<string, ReviewChoice> = { a: "accept", e: "edit", d: "drop" };
  return {
    show: (line) => process.stdout.write(`${line}\n`),
    async choose(question) {
      for (;;) {
        const answer = (await rl.question(`${question} [a]ccept / [e]dit / [d]rop: `)).trim().toLowerCase();
        const choice = keys[answer.charAt(0) || "a"];
        if (choice) return choice;
      }
    },
    async edit(yaml) {
      process.stdout.write(`Current definition:\n${yaml}Enter the new YAML, then an empty line:\n`);
      const lines: string[] = [];
      for (;;) {
        const line = await rl.question("");
        if (!line.trim()) break;
        lines.push(line);
      }
      return lines.join("\n");
    },
    close: () => rl.close(),
  };
}

function terminalReview(): ReviewPrompt & { close(): void } {
  const io = terminalIO();
  return { show: io.show, choose: (q) => io.choose(q, ["accept", "edit", "drop"]), edit: io.edit, close: io.close };
}

const today = (t?: string) => t ?? new Date().toISOString().slice(0, 10);

const analyze = defineCommand({
  meta: {
    name: "analyze",
    description: "Run a full job locally with a live stage view and metric review; write the report to <out>/agentic-analytics/",
  },
  args: {
    web: { type: "boolean", description: "Enable the web lane (sanitized SearXNG searches)" },
    objective: { type: "string", description: "The business goal recommendations are ranked by" },
    yes: { type: "boolean", description: "Keep drafted metrics as assumptions without asking" },
    "small-model": { type: "boolean", description: "Small-model mode" },
    out: { type: "string", description: "Folder for the report (default: the current folder)" },
    open: { type: "boolean", description: "Open report.html when done" },
    currency: { type: "string", description: "ISO 4217 code for money columns with no currency marked" },
    today: { type: "string", description: "Today's date (YYYY-MM-DD)" },
    embedder: { type: "string", description: "'hash' for the offline embedder, else the configured transformers model" },
    log: { type: "boolean", description: "Write structured logs to stderr" },
  },
  async run({ args }) {
    const paths = collectPaths(args._ as string[]);
    if (!paths.length) throw new Error("give one or more files or folders: aa analyze <paths…>");
    const rt = runtime(args.embedder);
    const review = args.yes ? undefined : terminalReview();
    try {
      const r = await analyzeCommand(
        {
          files: paths.map((p) => ({ name: basename(p), bytes: new Uint8Array(readFileSync(p)) })),
          options: {
            today: today(args.today),
            ...(args.currency ? { currency: args.currency.toUpperCase() } : {}),
            ...(args.objective ? { objective: args.objective } : {}),
            ...(args["small-model"] ? { smallModel: true } : {}),
            ...(args.web ? { web: true } : {}),
          },
          out: args.out ?? ".",
        },
        { manager: rt.manager(Boolean(args.log)), print, ...(review ? { review } : {}) },
      );
      process.exitCode = r.code;
      if (args.open && r.htmlPath) {
        const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
        spawn(opener, [r.htmlPath], { detached: true, stdio: "ignore" }).unref();
      }
    } finally {
      review?.close();
    }
  },
});

const ask = defineCommand({
  meta: { name: "ask", description: "Ask a follow-up question about a finished job; the answer is verified claims" },
  args: { job: { type: "positional", required: true }, question: { type: "positional", required: true } },
  async run({ args }) {
    process.exitCode = await askCommand(runtime("hash").manager(), args.job, args.question, print);
  },
});

const explain = defineCommand({
  meta: { name: "explain", description: "Show the computation behind a number: SQL, parameters, definition, input rows" },
  args: { job: { type: "positional", required: true }, fact: { type: "positional", required: true } },
  async run({ args }) {
    process.exitCode = await explainCommand(runtime("hash").manager(), args.job, args.fact, print);
  },
});

const serveCmd = defineCommand({
  meta: { name: "serve", description: "Start the HTTP API (with the viewer at / and MCP at /mcp)" },
  args: {
    port: { type: "string", description: "Port (default 8080)" },
    host: { type: "string", description: "Interface to listen on (default 127.0.0.1)" },
    embedder: { type: "string", description: "'hash' for the offline embedder" },
    log: { type: "boolean", description: "Write structured logs to stderr" },
    "allow-no-auth": {
      type: "boolean",
      description: "Listen beyond localhost without API_TOKEN (only behind a proxy or a localhost-only port mapping)",
    },
  },
  async run({ args }) {
    const rt = runtime(args.embedder);
    const manager = rt.manager(Boolean(args.log));
    let cached: { at: number; value: Record<string, { ok: boolean; detail?: string }> } | undefined;
    const health = async () => {
      // The doctor's checks, at most once a minute (it calls the planner model once).
      if (cached && Date.now() - cached.at < 60_000) return cached.value;
      const file = configFile();
      const results = await runDoctor({
        nodeVersion: runtimeVersion(process.env, process.versions, process.version),
        duckdbVersion,
        fetch: globalThis.fetch,
        env: process.env,
        modelClient: (config) => createModelClient(config, { env: process.env, onCall: logCall }),
        ...(file !== undefined ? { configFile: file } : {}),
        roles: ["planner"],
      });
      const value = Object.fromEntries(results.map((r) => [r.name, { ok: r.status === "ok", detail: r.detail }]));
      cached = { at: Date.now(), value };
      return value;
    };
    const s = await startServer(manager, {
      port: Number(args.port ?? process.env.PORT ?? 8080),
      ...(args.host ? { hostname: args.host } : {}),
      ...(process.env.API_TOKEN ? { token: process.env.API_TOKEN } : {}),
      ...(args["allow-no-auth"] || process.env.AA_ALLOW_NO_AUTH === "1" ? { allowNoAuth: true } : {}),
      // Names this server may be reached by besides localhost (a LAN name, a Docker service name).
      allowedHosts: [
        ...(args.host && args.host !== "0.0.0.0" ? [args.host] : []),
        ...(process.env.AA_ALLOWED_HOSTS ?? "")
          .split(",")
          .map((h) => h.trim())
          .filter(Boolean),
      ],
      health,
      onError: logInternal,
      mcp: mcpHttpHandler(manager, {
        version: ENGINE_VERSION,
        onError: logInternal,
        roots: (process.env.AA_MCP_ROOTS ?? "")
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean),
      }),
      // The binary carries no viewer build: the API, MCP and report.html still work.
      ...(isStandalone(process.env) ? {} : { viewerDir: fileURLToPath(new URL("../../viewer/dist", import.meta.url)) }),
      version: ENGINE_VERSION,
    }).catch((err: unknown) => {
      // A refused network bind is a configuration message, not a crash.
      if (err instanceof ServeError) {
        process.stderr.write(`${err.message}\n`);
        process.exitCode = 1;
        return undefined;
      }
      throw err;
    });
    if (!s) return;
    print(
      `agentic-analytics API on ${s.url} (${isStandalone(process.env) ? "no viewer in the standalone binary" : "viewer at /"}, OpenAPI at /openapi.json, MCP at /mcp)`,
    );
  },
});

const mcp = defineCommand({
  meta: { name: "mcp", description: "Start the MCP server on stdio (for Claude Desktop and other MCP clients)" },
  args: { embedder: { type: "string", description: "'hash' for the offline embedder" } },
  async run({ args }) {
    // stderr is safe on stdio (stdout carries the protocol): unexpected errors are logged, the client gets a short message.
    await serveStdio(runtime(args.embedder).manager(), { version: ENGINE_VERSION, onError: logInternal });
  },
});

const jobs = defineCommand({
  meta: { name: "jobs", description: "Manage jobs: ls, rm <id>, resume <id>" },
  subCommands: {
    ls: defineCommand({
      meta: { name: "ls", description: "List jobs" },
      async run() {
        process.exitCode = await jobsList(runtime("hash").manager(), print);
      },
    }),
    rm: defineCommand({
      meta: { name: "rm", description: "Delete a job and its data" },
      args: { job: { type: "positional", required: true } },
      async run({ args }) {
        await runtime("hash").manager().delete(args.job);
        print(`deleted ${args.job}`);
      },
    }),
    resume: defineCommand({
      meta: { name: "resume", description: "Continue a stopped job from its last completed stage" },
      args: { job: { type: "positional", required: true }, embedder: { type: "string", description: "'hash' for the offline embedder" } },
      async run({ args }) {
        const manager = runtime(args.embedder).manager();
        await manager.resume(args.job);
        const unsubscribe = await manager.subscribe(args.job, (e) => {
          const line = formatEvent(e);
          if (line) print(line);
        });
        const s = await manager.wait(args.job);
        unsubscribe();
        print(`${args.job}: ${s.status}`);
        process.exitCode = s.status === "done" ? 0 : 1;
      },
    }),
  },
});

const evalCmd = defineCommand({
  meta: { name: "eval", description: "Run the eval suite on the generated datasets (or the real public ones) and update evals/RESULTS.md" },
  args: {
    suite: {
      type: "string",
      description:
        "smoke (3 datasets), full (30 datasets), real (public datasets; run `bun run eval:real:fetch` first) or golden (the real datasets' golden sets); default smoke",
    },
    model: {
      type: "string",
      description: "baseline (scripted heuristic, no LLM), configured (the .env/config models), or a model like ollama:qwen3.5:9b",
    },
    "small-model": { type: "boolean", description: "Small-model mode" },
    embedder: { type: "string", description: "'hash' (default) or a transformers embedding model" },
    "keep-reports": { type: "string", description: "Keep each dataset's report.json in this folder" },
    "replay-drafts": {
      type: "string",
      description:
        "With --model baseline: a --keep-reports folder whose <dataset>.metrics.drafted.json answer the metric drafts (a real model's metrics, no model call)",
    },
    "results-dir": {
      type: "string",
      description: "Where results files and RESULTS.md go (default evals/results; ./eval-results with --answers)",
    },
    label: {
      type: "string",
      description: 'The model name in RESULTS.md, the README and the results file name, e.g. "vllm (Kaggle 2×T4) Qwen3.8-27B-AWQ"',
    },
    note: { type: "string", description: "A note shown above the run's table in RESULTS.md (hardware, caveats)" },
    passes: {
      type: "string",
      description:
        "Carry the run over up to this many passes (e.g. 2 nights): resume this row's unfinished jobs from its latest result instead of starting again",
    },
    only: {
      type: "string",
      description: "Comma-separated dataset ids to run (a chunk of a long run; needs --results-dir so it never lands in evals/results)",
    },
    answers: {
      type: "string",
      description: "With --suite real: a folder of your own answer files (<dataset>.yaml) instead of evals/real/answers",
    },
    models: {
      type: "string",
      description: "Comma-separated models to run the suite with one after another, each its own results row (the model matrix)",
    },
    data: {
      type: "string",
      description: "With --suite real: the folder holding the files the answer files name (default: the --answers folder)",
    },
    dataset: { type: "string", description: "With --suite golden: one dataset (default: every real dataset with a golden set)" },
    split: { type: "string", description: "With --suite golden: dev (default) or heldout (release runs only)" },
  },
  async run({ args }) {
    const model = args.model ?? "baseline";
    if ((args.answers || args.data) && args.suite !== "real") throw new Error("--answers and --data go with --suite real");
    if ((args.dataset || args.split) && args.suite !== "golden") throw new Error("--dataset and --split go with --suite golden");
    if (args.suite === "golden" && (args["keep-reports"] || args["small-model"] || args["replay-drafts"] || args["results-dir"]))
      throw new Error("--suite golden takes --dataset, --split, --model and --embedder only (it prints its results)");
    if (
      (args.label || args.note || args.only !== undefined || args.passes !== undefined) &&
      (args.suite === "real" || args.suite === "golden")
    )
      throw new Error("--label, --note, --only and --passes go with --suite smoke|full");
    const nightly = nightlyArgs(
      { model, ...(args.label ? { label: args.label } : {}), ...(args.passes !== undefined ? { passes: args.passes } : {}) },
      () => resolveModelConfig(process.env, configFile()).models,
    );
    const checkoutResults = fileURLToPath(new URL("../../../evals/results", import.meta.url));
    // A chunk is a partial run: it must never become the published row in evals/results.
    const refused =
      onlyProblem(args.only, args["results-dir"], process.cwd(), checkoutResults) ??
      replayProblem(args["replay-drafts"], args["results-dir"], process.cwd(), checkoutResults);
    if (refused) throw new Error(refused);
    const only = args.only === undefined ? undefined : onlyIds(args.only);
    const cacheDir = modelsDir();
    const where = resultsLocation(args["results-dir"], process.env, process.cwd(), checkoutResults, Boolean(args.answers));
    const evalRouter = new Router();
    const evalCache = fileCache(process.env.AA_MODEL_CACHE ?? fileURLToPath(new URL("../../../evals/.cache", import.meta.url)));
    const deps = {
      // Evals default to the hash embedder everywhere (deterministic, no download), unlike analyze.
      embedder: !args.embedder || args.embedder === "hash" ? hashEmbedder() : transformersEmbedder({ model: args.embedder, cacheDir }),
      print,
      modelFor: (name: string, onCall?: (c: CallRecord) => void) => {
        // One model for every role, unless "configured" keeps the per-role settings.
        const env = name === "configured" ? process.env : { ...process.env, PLANNER_MODEL: name, EXTRACTOR_MODEL: name, JUDGE_MODEL: name };
        // Shared across datasets: the router keeps each route's rate state, the cache makes reruns free.
        return createModelClient(resolveModelConfig(env, configFile()), {
          env: process.env,
          router: evalRouter,
          cache: evalCache,
          onCall: (c) => {
            onCall?.(c);
            logCall(c);
          },
        });
      },
    };
    if (args.models !== undefined) {
      if (args.suite !== undefined && args.suite !== "smoke" && args.suite !== "full")
        throw new Error(`--models runs --suite smoke or full, not ${args.suite}`);
      if (args.model || args.label || args.passes !== undefined || args["replay-drafts"])
        throw new Error(
          "--models runs a smoke or full suite per model: drop --model, --label, --passes and --replay-drafts, and use --suite smoke|full",
        );
      const runs = await evalMatrix(
        args.models
          .split(",")
          .map((m) => m.trim())
          .filter(Boolean),
        {
          suite: args.suite === "full" ? "full" : "smoke",
          ...(args["small-model"] ? { smallModel: true } : {}),
          ...(args["keep-reports"] ? { keepReports: args["keep-reports"] } : {}),
          ...(args.note ? { note: args.note } : {}),
          ...(only?.length ? { only } : {}),
          resultsDir: where.dir,
          ...(where.page ? { resultsPage: where.page } : {}),
        },
        deps,
      );
      process.exitCode = runs.every((r) => r.result?.bars.every((b) => b.pass !== false)) ? 0 : 1;
      return;
    }
    if (args.suite === "golden") {
      if (args.split !== undefined && args.split !== "dev" && args.split !== "heldout")
        throw new Error(`--split must be dev or heldout, not "${args.split}"`);
      // Scored and printed, not published: golden results reach RESULTS.md with the baseline report (M14 PR 8).
      const runs = await goldenEvalCommand(
        {
          model,
          ...(args.dataset ? { dataset: args.dataset } : {}),
          split: args.split === "heldout" ? "heldout" : "dev",
          dataDir: fileURLToPath(new URL("../../../evals/real/data", import.meta.url)),
          answersDir: fileURLToPath(new URL("../../../evals/real/answers", import.meta.url)),
        },
        deps,
      );
      process.exitCode = runs.every((r) => r.completed) ? 0 : 1;
      return;
    }
    if (args.suite === "real") {
      const r = await realEvalCommand(
        {
          model,
          resultsDir: where.dir,
          ...(where.page ? { resultsPage: where.page } : {}),
          dataDir: args.data ?? args.answers ?? fileURLToPath(new URL("../../../evals/real/data", import.meta.url)),
          answersDir: args.answers ?? fileURLToPath(new URL("../../../evals/real/answers", import.meta.url)),
          ...(args["keep-reports"] ? { keepReports: args["keep-reports"] } : {}),
        },
        deps,
      );
      process.exitCode = r.datasets.every((d) => d.checks.every((c) => c.pass)) ? 0 : 1;
      return;
    }
    const r = await evalCommand(
      {
        suite: args.suite === "full" ? "full" : "smoke",
        model,
        ...(args["small-model"] ? { smallModel: true } : {}),
        ...(args["keep-reports"] ? { keepReports: args["keep-reports"] } : {}),
        ...(args.label ? { label: args.label } : {}),
        ...(args.note ? { note: args.note } : {}),
        ...(args["replay-drafts"] ? { replayDrafts: args["replay-drafts"] } : {}),
        // A configured run is named after its routes (its file keeps the "configured" name), and --passes checks
        // each role's model before carrying an earlier result on.
        ...nightly,
        ...(only?.length ? { only } : {}),
        resultsDir: where.dir,
        ...(where.page ? { resultsPage: where.page } : {}),
      },
      deps,
    );
    process.exitCode = r.bars.every((b) => b.pass !== false) ? 0 : 1;
  },
});

const metrics = defineCommand({
  meta: { name: "metrics", description: "Draft, validate and confirm metric definitions for files, and show their SQL and values" },
  args: {
    yes: { type: "boolean", description: "Accept every drafted metric as an assumption without asking" },
    save: { type: "string", description: "Write the confirmed definitions to this YAML file (e.g. agentic-analytics.metrics.yaml)" },
    metrics: { type: "string", description: "Reuse definitions from this YAML file instead of drafting" },
    currency: { type: "string", description: "ISO 4217 code for money columns with no currency marked (default: none)" },
    today: { type: "string", description: "Today's date for the future-date check (YYYY-MM-DD)" },
  },
  async run({ args }) {
    const paths = collectPaths(args._ as string[]);
    if (!paths.length) throw new Error("give one or more files or folders: aa metrics <paths…>");
    let model: ModelClient | undefined;
    let modelError: string | undefined;
    try {
      model = createModelClient(resolveModelConfig(process.env, configFile()), { env: process.env, onCall: logCall });
    } catch (err) {
      // An invalid model config is reported, not hidden: drafting falls back and says why.
      modelError = err instanceof Error ? err.message : String(err);
    }
    const io = args.yes ? undefined : terminalIO();
    try {
      const outcome = await runMetricsCommand(
        {
          files: paths.map((p) => ({ name: basename(p), bytes: new Uint8Array(readFileSync(p)) })),
          yes: Boolean(args.yes),
          today: args.today ?? new Date().toISOString().slice(0, 10),
          ...(args.currency ? { currency: args.currency.toUpperCase() } : {}),
          ...(args.metrics ? { metricsFile: readFileSync(args.metrics, "utf8") } : {}),
        },
        {
          out: (l) => process.stdout.write(`${l}\n`),
          ...(io ? { io } : {}),
          ...(model ? { model } : {}),
          ...(modelError ? { modelError } : {}),
        },
      );
      if (outcome.ended) {
        process.exitCode = 1;
        return;
      }
      if (args.save) {
        writeFileSync(args.save, outcome.yaml);
        process.stdout.write(`\nSaved ${outcome.accepted} metric(s) to ${args.save}\n`);
      }
    } finally {
      io?.close();
    }
  },
});

const usage = defineCommand({
  meta: {
    name: "usage",
    description: "Tokens and calls per day, per role and per route, against each route's free-tier daily limit",
  },
  args: {
    day: { type: "string", description: "One UTC day, YYYY-MM-DD (default: every day in the log, newest first)" },
    log: { type: "string", description: "The call log to read (default data/logs/model-calls.jsonl); never written" },
    json: { type: "boolean", description: "Print JSON instead of text" },
  },
  run({ args }) {
    // The limits come from the route config (models §4): the built-in presets plus the config file's endpoints.
    let config: ReturnType<typeof resolveModelConfig>;
    try {
      config = resolveModelConfig(process.env, configFile());
    } catch (err) {
      process.stderr.write(`Model config not usable (${err instanceof Error ? err.message : String(err)}); using the built-in limits.\n`);
      config = resolveModelConfig({});
    }
    try {
      process.stdout.write(
        usageCommand(args.log ?? join("data", "logs", "model-calls.jsonl"), {
          ...(args.day !== undefined ? { day: args.day } : {}),
          ...(args.json ? { json: true } : {}),
          limitOf: (r) => dailyTokenLimit(config, r),
        }),
      );
    } catch (err) {
      // A missing log or a bad --day is a usage mistake: one line, no stack.
      if (!(err instanceof UsageError || (err instanceof ModelError && err.code === "INVALID_ARGUMENT"))) throw err;
      process.stderr.write(`aa usage: ${err.message}\n`);
      process.exitCode = 1;
    }
  },
});

const run = defineCommand({
  meta: { name: "run", description: "Run a full job on files (or --resume a job folder) and write the draft report" },
  args: {
    dir: { type: "string", description: "Job folder (default: data/jobs/<timestamp>)" },
    resume: { type: "string", description: "Continue the interrupted job in this folder" },
    today: { type: "string", description: "Today's date for the future-date check (YYYY-MM-DD)" },
    currency: { type: "string", description: "ISO 4217 code for money columns with no currency marked" },
    objective: { type: "string", description: "The business goal recommendations are ranked by" },
    "small-model": { type: "boolean", description: "Small-model mode: fewer tool calls and findings, form-filling explanations" },
    web: {
      type: "boolean",
      description: "Enable the web lane: sanitized searches through SearXNG ($SEARXNG_URL, default http://localhost:8888)",
    },
    embedder: { type: "string", description: "'hash' for the offline embedder, else the configured transformers model" },
    log: { type: "boolean", description: "Write structured logs to stderr" },
  },
  async run({ args }) {
    const resume = args.resume;
    const paths = collectPaths(args._ as string[]);
    if (!resume && !paths.length) throw new Error("give files or folders (aa run <paths…>), or --resume <job folder>");
    const config = resolveModelConfig(process.env, configFile());
    const plannerProfile = profileFor(describeRoleModel(config.models.planner));
    const model = createModelClient(config, {
      env: process.env,
      onCall: logCall,
      ...(process.env.AA_MODEL_CACHE ? { cache: fileCache(process.env.AA_MODEL_CACHE) } : {}),
    });
    const embedder = pickEmbedder(args.embedder, config.models.embedder.model, modelsDir());
    const dir =
      resume ??
      args.dir ??
      join(
        "data",
        "jobs",
        new Date()
          .toISOString()
          .replace(/[-:.TZ]/g, "")
          .slice(0, 14),
      );
    process.exitCode = await runCommand(
      {
        dir,
        files: paths.map((p) => ({ name: basename(p), bytes: new Uint8Array(readFileSync(p)) })),
        ...(resume
          ? {}
          : {
              options: {
                today: args.today ?? new Date().toISOString().slice(0, 10),
                ...(args.currency ? { currency: args.currency.toUpperCase() } : {}),
                ...(args.objective ? { objective: args.objective } : {}),
                // --small-model, or the planner model's profile (models §4, agent-and-verifier §8).
                ...(args["small-model"] || plannerProfile?.smallModel ? { smallModel: true } : {}),
                ...(args.web ? { web: true } : {}),
              },
            }),
      },
      {
        model,
        embedder,
        // The web lane uses the self-hosted SearXNG (docker compose --profile web up -d searxng).
        ...(args.web ? { web: { provider: searxng() } } : {}),
        engine: {
          version: ENGINE_VERSION,
          models: (["planner", "extractor", "judge"] as const).map((role) => ({
            role,
            provider: config.models[role].provider,
            model: config.models[role].model,
          })),
        },
        ...(args.log ? { log: createLogger(jsonLines((l) => process.stderr.write(l))) } : {}),
        out: (l) => process.stdout.write(`${l}\n`),
        // The resume hint must keep the embedder the job was indexed with.
        resumeFlags: [...(args.embedder ? ["--embedder", args.embedder] : []), ...(args.web ? ["--web"] : [])],
      },
    );
  },
});

export const main = defineCommand({
  meta: { name: "aa", description: "agentic-analytics: files in, verified report out" },
  subCommands: { analyze, ask, explain, serve: serveCmd, mcp, jobs, eval: evalCmd, doctor, metrics, run, usage },
});

await runMain(main);
