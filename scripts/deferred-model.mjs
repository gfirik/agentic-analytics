// Picks the Groq model for the deferred nightly runs (scripts/eval-deferred.sh) from the models Groq serves today.
// Groq's free quota is per model, so a model the nightly full suite doesn't use leaves the full suite's quota
// untouched; that is the first choice. Groq retires models often (on 2026-10-23 it served no model from the first
// list below, and no general chat model at all beside the full suite's three), so when no unused model fits, the run
// shares a model with the full suite: the judge's, then the extractor's, never the planner's, which spends the most.
// The deferred run starts after the full suite (heavy.sh's lock), so it uses what is left of that day's quota.
// Prints the model id (the reason for a shared one on stderr); exits 1 with the reason when nothing fits.
// The key is read from .env as the CLI reads it, and never printed.
import { existsSync } from "node:fs";

// Tool-calling models (arm B and the engine's planner need tools), roughly most capable first.
const PREFERRED = [
  "moonshotai/kimi-k2-instruct-0905",
  "moonshotai/kimi-k2-instruct",
  "llama-3.3-70b-versatile",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "qwen/qwen3-32b",
];
// Not general chat models: speech, guards and safety classifiers.
const NOT_CHAT = /whisper|orpheus|tts|playai|guard|safeguard/i;
// The engine's prompts with a profile and tool results need far more than a small window.
const MIN_CONTEXT = 32_768;
// Role settings, in the order a deferred run may share their model; the planner's is never shared.
const SHAREABLE = ["JUDGE_MODEL", "EXTRACTOR_MODEL"];
const ROLES = ["PLANNER_MODEL", "EXTRACTOR_MODEL", "JUDGE_MODEL", "SMALL_MODEL"];

/** The Groq model ids a role setting names (a route list is "a|b"; a route is "openai-compatible:groq:<model>"). */
export function routeModels(value) {
  return (value ?? "")
    .split("|")
    .map((route) => route.trim())
    .filter((route) => route.startsWith("openai-compatible:groq:"))
    .map((route) => route.slice("openai-compatible:groq:".length));
}

/**
 * The model for tonight from Groq's /models `data` and the role settings (env-like record). Returns
 * `{ model, shared }` (shared names the role whose model it borrows) or `{ error }`.
 */
export function pickModel(served, env) {
  const fit = served
    .filter((m) => m && typeof m.id === "string" && m.active !== false)
    .filter((m) => !NOT_CHAT.test(m.id) && (m.context_window ?? 0) >= MIN_CONTEXT)
    .map((m) => m.id);
  const used = new Set(ROLES.flatMap((r) => routeModels(env[r])));
  const fresh = PREFERRED.find((m) => fit.includes(m) && !used.has(m)) ?? fit.find((m) => !used.has(m));
  if (fresh) return { model: fresh, shared: null };
  for (const role of SHAREABLE) {
    const model = routeModels(env[role]).find((m) => fit.includes(m));
    if (model) return { model, shared: role };
  }
  return { error: `no served chat model fits (served: ${served.map((m) => m?.id).join(", ") || "none"})` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (existsSync(".env")) process.loadEnvFile(".env");
  // Read by name: this script runs from cron, never under turbo, so it has no place in turbo.json's env lists.
  const KEY = "GROQ_API_KEY";
  const key = process.env[KEY];
  if (!key) {
    process.stderr.write("deferred-model: GROQ_API_KEY is not set\n");
    process.exit(1);
  }
  // Up to four tries a few seconds apart: one "fetch failed" would otherwise skip the night (two in a row on
  // 2026-10-23 before the third worked).
  let served;
  for (let attempt = 1; !served; attempt++) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      served = (await res.json()).data ?? [];
    } catch (err) {
      process.stderr.write(`deferred-model: Groq's model list failed: ${err instanceof Error ? err.message : err}\n`);
      if (attempt >= 4) process.exit(1);
      await new Promise((r) => setTimeout(r, 5_000 * attempt));
    }
  }
  const env = Object.fromEntries(ROLES.map((r) => [r, process.env[r]]));
  const r = pickModel(served, env);
  if (r.error) {
    process.stderr.write(`deferred-model: ${r.error}\n`);
    process.exit(1);
  }
  if (r.shared) process.stderr.write(`deferred-model: no unused model is served; sharing ${r.shared}'s ${r.model} with the full suite\n`);
  process.stdout.write(`${r.model}\n`);
}
