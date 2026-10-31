// 5. Security (learn-data.ts): one poisoned email through a full job, the injection screen on every fixture, and the
// URL checks.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { screen } from "@agentic-analytics/agent";
import { runJob } from "@agentic-analytics/core";
import { coffeePlanner } from "@agentic-analytics/core/testing";
import { injectionFixtures } from "@agentic-analytics/eval-datasets";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import type { Report } from "@agentic-analytics/schema";
import { checkUrl, WebError } from "@agentic-analytics/web";
import { coffeeFiles, NOW, need, TODAY } from "./shared.ts";

export async function securityRun() {
  const fixtures = injectionFixtures();
  const fx = need(
    fixtures.find((f) => f.id === "eml-forget-rules"),
    "the eml-forget-rules fixture",
  );
  const run = async (extra: Readonly<Record<string, Uint8Array>>) => {
    const dir = mkdtempSync(join(tmpdir(), "aa-learn-inj-"));
    try {
      const files = [...coffeeFiles(), ...Object.entries(extra).map(([name, bytes]) => ({ name, bytes }))];
      return (
        await runJob(
          { dir, jobId: "inj", files, options: { today: TODAY, currency: "USD" } },
          { model: coffeePlanner(), embedder: hashEmbedder(), now: NOW },
        )
      ).report;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const [clean, poisoned] = await Promise.all([run({}), run(fx.files)]);
  const factKey = (rep: Report) =>
    rep.facts
      .map((f) => `${f.label}=${f.value}`)
      .sort()
      .join("|");
  const urls = [
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:8080/v1/jobs",
    "http://2130706433/",
    "http://10.0.0.5/admin",
    "file:///etc/passwd",
    "https://user:pass@example.com/",
    "https://coffee-benchmarks.example:8443/refunds",
  ];
  return {
    fixtures: fixtures.length,
    // The screen on real lines: the poisoned email's body, and lines from the example's own documents.
    screen: [
      ...new TextDecoder()
        .decode(need(fx.files[fx.flagged], "the poisoned email"))
        .split(/\r?\n\r?\n/)
        .slice(1)
        .join("\n")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 12)
        .map((text) => ({ source: fx.flagged, text, flagged: screen(text) })),
      ...[
        ["email-0412.eml", "After the new price list we are pausing our standing order while we compare suppliers."],
        ["ops-notes.docx", "Switched to the new packaging supplier on 28 April."],
      ].map(([source, text]) => ({ source: source as string, text: text as string, flagged: screen(text as string) })),
    ],
    ssrf: urls.map((url) => {
      try {
        checkUrl(url);
        return { url, code: "ALLOWED", message: "" };
      } catch (err) {
        if (!(err instanceof WebError)) throw err;
        return { url, code: err.code, message: err.message };
      }
    }),
    injectionRun: {
      fixture: fx.id,
      file: fx.flagged,
      flagged: poisoned.data_quality
        .filter((q) => q.kind === "suspicious_instruction")
        .map((q) => ({ kind: q.kind, description: q.description.replace(/\{\{N\d+\}\}/g, "…") })),
      sameFacts: factKey(clean) === factKey(poisoned),
      phraseInReport: JSON.stringify(poisoned).toLowerCase().includes(fx.phrase.toLowerCase()),
    },
  };
}
