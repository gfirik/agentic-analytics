import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { createLogger, jsonLines } from "@agentic-analytics/core";
import type { ReviewChoice, ReviewIO } from "@agentic-analytics/metrics";
import { createModelClient, type ModelClient, profileFor, resolveModelConfig } from "@agentic-analytics/models";
import { hashEmbedder, transformersEmbedder } from "@agentic-analytics/retrieval";
import { duckdbVersion } from "@agentic-analytics/store";
import { defineCommand, runMain } from "citty";
import { parse } from "yaml";
import { exitCode, formatReport, runDoctor } from "./doctor.ts";
import { runMetricsCommand } from "./metrics.ts";
import { runCommand } from "./run.ts";

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
    web: { type: "boolean", description: "Enable the web lane (built in M8)" },
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
        resumeFlags: args.embedder ? ["--embedder", args.embedder] : [],
      },
    );
  },
});

export const main = defineCommand({
  meta: { name: "aa", description: "agentic-analytics: files in, verified report out" },
  subCommands: { doctor, metrics, run },
});

await runMain(main);
