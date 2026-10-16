import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createLogger, type JobDeps, JobManager, type JobOptions, jsonLines } from "@agentic-analytics/core";
import { mcpHttpHandler, serveStdio } from "@agentic-analytics/mcp";
import type { ReviewChoice, ReviewIO } from "@agentic-analytics/metrics";
import { createModelClient, type ModelClient, profileFor, resolveModelConfig } from "@agentic-analytics/models";
import { hashEmbedder, transformersEmbedder } from "@agentic-analytics/retrieval";
import { startServer } from "@agentic-analytics/server";
import { duckdbVersion } from "@agentic-analytics/store";
import { searxngProvider } from "@agentic-analytics/web";
import { defineCommand, runMain } from "citty";
import { parse } from "yaml";
import { analyzeCommand, type ReviewPrompt } from "./analyze.ts";
import { exitCode, formatReport, runDoctor } from "./doctor.ts";
import { askCommand, explainCommand, jobsList } from "./followup.ts";
import { runMetricsCommand } from "./metrics.ts";
import { formatEvent, runCommand } from "./run.ts";

// The CLI reads .env like the server will; values stay in process.env and are never printed.
if (existsSync(".env")) process.loadEnvFile(".env");
const CONFIG_FILE = "agentic-analytics.config.yaml";
const configFile = () => (existsSync(CONFIG_FILE) ? (parse(readFileSync(CONFIG_FILE, "utf8")) as unknown) : undefined);

const doctor = defineCommand({
  meta: { name: "doctor", description: "Check Node, DuckDB, model providers, SearXNG and Docling; call the planner model once" },
  async run() {
    const file = configFile();
    const results = await runDoctor({
      nodeVersion: process.version,
      duckdbVersion,
      fetch: globalThis.fetch,
      env: process.env,
      modelClient: (config) => createModelClient(config, { env: process.env }),
      ...(file !== undefined ? { configFile: file } : {}),
    });
    process.stdout.write(formatReport(results));
    process.exitCode = exitCode(results);
  },
});

const collect = (p: string): string[] =>
  statSync(p).isDirectory()
    ? readdirSync(p)
        .sort()
        .flatMap((n) => collect(join(p, n)))
    : [p];

const ENGINE_VERSION = "0.0.0";
const jobsRoot = () => process.env.AA_JOBS_DIR ?? join("data", "jobs");
const print = (l: string) => process.stdout.write(`${l}\n`);

/** Models, embedder and web lane from the environment and config file, as every door uses them. */
function runtime(embedderArg?: string) {
  const config = resolveModelConfig(process.env, configFile());
  const model = createModelClient(config, { env: process.env });
  const cacheDir = process.env.AA_MODELS_DIR ?? join(homedir(), ".cache", "agentic-analytics", "models");
  const embedder =
    embedderArg === "hash" ? hashEmbedder() : transformersEmbedder({ model: embedderArg ?? config.models.embedder.model, cacheDir });
  const planner = config.models.planner;
  const plannerProfile = profileFor(
    planner.provider === "openai-compatible"
      ? `openai-compatible:${planner.endpoint}:${planner.model}`
      : `${planner.provider}:${planner.model}`,
  );
  const engine = {
    version: ENGINE_VERSION,
    models: (["planner", "extractor", "judge"] as const).map((role) => ({
      role,
      provider: config.models[role].provider,
      model: config.models[role].model,
    })),
  };
  const web = () => ({
    provider: searxngProvider({
      baseUrl: process.env.SEARXNG_URL ?? "http://localhost:8888",
      ...(process.env.SEARXNG_ENGINES ? { engines: process.env.SEARXNG_ENGINES } : {}),
    }),
  });
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
  const rl = createInterface({ input: process.stdin, output: process.stdout });
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
    const paths = (args._ as string[]).flatMap(collect);
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
        nodeVersion: process.version,
        duckdbVersion,
        fetch: globalThis.fetch,
        env: process.env,
        modelClient: (config) => createModelClient(config, { env: process.env }),
        ...(file !== undefined ? { configFile: file } : {}),
      });
      const value = Object.fromEntries(results.map((r) => [r.name, { ok: r.status === "ok", detail: r.detail }]));
      cached = { at: Date.now(), value };
      return value;
    };
    const s = await startServer(manager, {
      port: Number(args.port ?? process.env.PORT ?? 8080),
      ...(args.host ? { hostname: args.host } : {}),
      ...(process.env.API_TOKEN ? { token: process.env.API_TOKEN } : {}),
      // Names this server may be reached by besides localhost (a LAN name, a Docker service name).
      allowedHosts: [
        ...(args.host && args.host !== "0.0.0.0" ? [args.host] : []),
        ...(process.env.AA_ALLOWED_HOSTS ?? "")
          .split(",")
          .map((h) => h.trim())
          .filter(Boolean),
      ],
      health,
      mcp: mcpHttpHandler(manager, { version: ENGINE_VERSION }),
      viewerDir: fileURLToPath(new URL("../../viewer/dist", import.meta.url)),
      version: ENGINE_VERSION,
    });
    print(`agentic-analytics API on ${s.url} (viewer at /, OpenAPI at /openapi.json, MCP at /mcp)`);
  },
});

const mcp = defineCommand({
  meta: { name: "mcp", description: "Start the MCP server on stdio (for Claude Desktop and other MCP clients)" },
  args: { embedder: { type: "string", description: "'hash' for the offline embedder" } },
  async run({ args }) {
    await serveStdio(runtime(args.embedder).manager(), { version: ENGINE_VERSION });
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
  meta: { name: "eval", description: "Run the eval suites (the runner arrives in M11)" },
  args: { suite: { type: "string" }, model: { type: "string" } },
  run() {
    print("The eval runner lands in M11 (docs/ROADMAP.md). Available now:");
    print("  bun run --filter @agentic-analytics/retrieval eval:retrieval   # retrieval recall@8");
    print("  bunx vitest run packages/core/test/injection.test.ts           # injection suite");
    process.exitCode = 2;
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
    const paths = (args._ as string[]).flatMap(collect);
    if (!paths.length) throw new Error("give one or more files or folders: aa metrics <paths…>");
    let model: ModelClient | undefined;
    let modelError: string | undefined;
    try {
      model = createModelClient(resolveModelConfig(process.env, configFile()), { env: process.env });
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
      if (args.save) {
        writeFileSync(args.save, outcome.yaml);
        process.stdout.write(`\nSaved ${outcome.accepted} metric(s) to ${args.save}\n`);
      }
    } finally {
      io?.close();
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
    const paths = (args._ as string[]).flatMap(collect);
    if (!resume && !paths.length) throw new Error("give files or folders (aa run <paths…>), or --resume <job folder>");
    const config = resolveModelConfig(process.env, configFile());
    const planner = config.models.planner;
    const plannerProfile = profileFor(
      planner.provider === "openai-compatible"
        ? `openai-compatible:${planner.endpoint}:${planner.model}`
        : `${planner.provider}:${planner.model}`,
    );
    const model = createModelClient(config, { env: process.env });
    const cacheDir = process.env.AA_MODELS_DIR ?? join(homedir(), ".cache", "agentic-analytics", "models");
    const embedder =
      args.embedder === "hash" ? hashEmbedder() : transformersEmbedder({ model: args.embedder ?? config.models.embedder.model, cacheDir });
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
        ...(args.web
          ? {
              web: {
                provider: searxngProvider({
                  baseUrl: process.env.SEARXNG_URL ?? "http://localhost:8888",
                  ...(process.env.SEARXNG_ENGINES ? { engines: process.env.SEARXNG_ENGINES } : {}),
                }),
              },
            }
          : {}),
        engine: {
          version: "0.0.0",
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
  subCommands: { analyze, ask, explain, serve: serveCmd, mcp, jobs, eval: evalCmd, doctor, metrics, run },
});

await runMain(main);
