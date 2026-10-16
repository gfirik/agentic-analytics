// One real web-lane search without any model: sanitize → SearXNG → safe fetch → readable text.
//   bun run --filter @agentic-analytics/web web:search -- "<query>" [--private "Name A,Name B"]
// Needs SearXNG: docker compose --profile web up -d searxng (SEARXNG_URL, default http://localhost:8888).
import { searxngProvider, webSearch } from "../src/index.ts";

const args = process.argv.slice(2);
const i = args.indexOf("--private");
const names =
  i >= 0
    ? (args[i + 1] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
const query = args.filter((_, k) => k !== i && k !== i + 1).join(" ");
const engines = process.env.SEARXNG_ENGINES;
const provider = searxngProvider({ baseUrl: process.env.SEARXNG_URL ?? "http://localhost:8888", ...(engines ? { engines } : {}) });
const r = await webSearch(query, { provider, terms: { names } });
const lines = [
  `query as typed: ${query}`,
  `query as sent:  ${r.query}`,
  `removed: ${r.removed.map((x) => `${x.kind}`).join(", ") || "(nothing)"}`,
  ...r.pages.map((p) => `page: ${p.url} · “${p.title}” · ${p.text.length} chars · ${p.text.slice(0, 160).replace(/\s+/g, " ")}…`),
  ...r.skipped.map((s) => `skipped: ${s.url} (${s.code})`),
];
process.stdout.write(`${lines.join("\n")}\n`);
