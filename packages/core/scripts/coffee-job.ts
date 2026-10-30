// Runs (or resumes) a coffee-roaster-v1 job with the scripted FakeModel and the offline embedder and prints the
// draft in readable form. The M7 demo, and the child process the kill-and-resume test kills mid-stage.
//   bun run --filter @agentic-analytics/core job:coffee -- --dir <job folder> [--small] [--slow-ms N] [--events]
// --slow-ms delays every planner call, so a test can kill the process while EXPLAIN is running;
// --events prints each job event as a JSON line as it happens.
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import type { ModelClient } from "@agentic-analytics/models";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { findFreeNumerals, placeholders } from "@agentic-analytics/schema";
import { runJob } from "../src/index.ts";
import { coffeePlanner } from "../testing/coffee-planner.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = opt("--dir") ?? "data/jobs/coffee-demo";
const small = args.includes("--small");
const slow = Number(opt("--slow-ms") ?? 0);
const wait = () => new Promise((r) => setTimeout(r, slow));

const fake = coffeePlanner();
const model: ModelClient = slow
  ? {
      generateObject: async (a) => {
        if (a.role === "planner") await wait();
        return fake.generateObject(a);
      },
      generateWithTools: async (a) => {
        await wait();
        return fake.generateWithTools(a);
      },
      embed: (t) => fake.embed(t),
    }
  : fake;

const files = Object.entries(coffeeRoasterFiles()).map(([name, bytes]) => ({ name, bytes }));
const out = await runJob(
  { dir, jobId: "coffee-demo", files, options: { today: "2026-07-01", currency: "USD", ...(small ? { smallModel: true } : {}) } },
  {
    model,
    embedder: hashEmbedder(),
    engine: { version: "0.0.0", models: [{ role: "planner", provider: "fake", model: "coffee-planner" }] },
    ...(args.includes("--events") ? { onEvent: (e) => process.stdout.write(`${JSON.stringify(e)}\n`) } : {}),
  },
);
const r = out.report;
const facts = new Map(r.facts.map((f) => [f.id, f]));
const fill = (t: string) =>
  t.replace(
    /\{\{(N\d+)\}\}/g,
    (_, id: string) => `${Number((facts.get(id)?.value ?? Number.NaN).toFixed(2)).toLocaleString("en-US")}[${id}]`,
  );
const lines = [
  `job ${out.jobId}: ran ${out.run.ran.join(" → ") || "(nothing)"}${out.run.resumed.length ? ` · resumed ${out.run.resumed.join(", ")}` : ""} · skipped ${out.run.skipped.join(", ")}`,
  `draft: ${out.draftPath}`,
  `headline: ${fill(r.summary.headline)}`,
  ...r.findings.flatMap((f) => [
    `${f.id} [${f.type}, ${f.severity}, ${f.confidence}] ${f.title}`,
    ...f.claims.map(
      (c) =>
        `   (${c.causal_grade}) ${fill(c.text)}${c.citations.length ? `  ← ${c.citations.map((x) => `${x.source_id} “${x.quote ?? ""}”`).join("; ")}` : ""}`,
    ),
  ]),
  ...r.recommendations.flatMap((x) => [
    `${x.id} ${x.action} (because ${x.because.join(", ")}; impact ${fill(`{{${x.impact.low}}}`)} … ${fill(`{{${x.impact.high}}}`)}; check ${x.check.metric_id} ${x.check.comparator} ${fill(`{{${x.check.threshold}}}`)} by ${x.check.by})`,
    ...(x.not_advised ? [`   not advised: ${x.not_advised}`] : []),
  ]),
  `open questions: ${r.open_questions.length} · assumptions: ${r.assumptions.length} · facts: ${r.facts.length}`,
  `dropped: ${r.verification.claims_dropped.map((d) => `"${d.claim}" (${d.reason})`).join("; ")}`,
  `downgraded: ${r.verification.claims_downgraded.map((d) => `"${d.claim}" ${d.from}→${d.to}`).join("; ")}`,
  `free numerals in model text: ${[r.summary.headline, ...r.findings.flatMap((f) => [f.title, ...f.claims.map((c) => c.text)])].flatMap((t) => findFreeNumerals(t)).length} · placeholders: ${placeholders(JSON.stringify(r)).length}`,
];
process.stdout.write(`${lines.join("\n")}\n`);
