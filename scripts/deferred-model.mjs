// Picks the Groq model for the deferred nightly runs (scripts/eval-deferred.sh): the first model in PREFERRED that
// Groq serves today and that the nightly full suite doesn't use. Groq's free quota is per model, so a model of its own
// leaves the full suite's quota untouched. Prints the model id; exits 1 (with the reason on stderr) when none fits.
// The key is read from .env as the CLI reads it, and never printed.
import { existsSync } from "node:fs";

// Tool-calling models (arm B and the engine's planner need tools), roughly most capable first. The full suite's
// models (qwen/qwen3.8-27b, openai/gpt-oss-120b, openai/gpt-oss-20b on 2026-10-22) are left out on purpose, and any
// model the role settings name is skipped as well.
const PREFERRED = [
  "moonshotai/kimi-k2-instruct-0905",
  "moonshotai/kimi-k2-instruct",
  "llama-3.3-70b-versatile",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "qwen/qwen3-32b",
];

if (existsSync(".env")) process.loadEnvFile(".env");
// Read by name: this script runs from cron, never under turbo, so it has no place in turbo.json's env lists.
const KEY = "GROQ_API_KEY";
const key = process.env[KEY];
if (!key) {
  process.stderr.write("deferred-model: GROQ_API_KEY is not set\n");
  process.exit(1);
}
// Every model a role setting names (a route list is "a|b"; a route is "openai-compatible:groq:<model>").
const used = new Set(
  ["PLANNER_MODEL", "EXTRACTOR_MODEL", "JUDGE_MODEL", "SMALL_MODEL"]
    .flatMap((v) => (process.env[v] ?? "").split("|"))
    .map((route) => route.replace(/^openai-compatible:groq:/, "").trim())
    .filter(Boolean),
);
let served;
try {
  const res = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  served = new Set(((await res.json()).data ?? []).map((m) => m.id));
} catch (err) {
  process.stderr.write(`deferred-model: Groq's model list failed: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
}
const pick = PREFERRED.find((m) => served.has(m) && !used.has(m));
if (!pick) {
  process.stderr.write(`deferred-model: none of ${PREFERRED.join(", ")} is served and unused by the full suite\n`);
  process.exit(1);
}
process.stdout.write(`${pick}\n`);
