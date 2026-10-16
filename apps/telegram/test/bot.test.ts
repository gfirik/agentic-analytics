// M10: the Telegram demo over long polling, with a fake Bot API (grammY transformer) and the real HTTP API in
// process. The user sends the coffee-roaster files and a question; the bot edits one status message through the
// stages, then replies with the summary and report.html.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobManager } from "@agentic-analytics/core";
import { coffeePlanner } from "@agentic-analytics/core/testing";
import { coffeeRoasterFiles } from "@agentic-analytics/eval-datasets";
import { hashEmbedder } from "@agentic-analytics/retrieval";
import { createApp } from "@agentic-analytics/server";
import { afterAll, describe, expect, it } from "vitest";
import { ApiClient, createBot } from "../src/index.ts";

const root = mkdtempSync(join(tmpdir(), "aa-tg-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const manager = new JobManager({ root, model: coffeePlanner(), deps: () => ({ model: coffeePlanner(), embedder: hashEmbedder() }) });
const app = createApp(manager, { today: () => "2026-07-01", token: "t0k" });
const api = new ApiClient({ baseUrl: "http://engine.local", token: "t0k", fetch: async (url, init) => app.request(url, init) });
const files = coffeeRoasterFiles();
const names = Object.keys(files);

const chat = { id: 42, type: "private" as const, first_name: "Owner" };
const from = { id: 42, is_bot: false, first_name: "Owner" };
let updateId = 0;
let messageId = 100;
const message = (extra: Record<string, unknown>) => ({
  update_id: ++updateId,
  message: { message_id: ++messageId, date: 0, chat, from, ...extra },
});

describe("Telegram bot (long polling)", () => {
  it("collects files, runs the job with auto_confirm, edits one status message, and replies with the summary and report.html", async () => {
    const calls: { method: string; payload: Record<string, unknown> }[] = [];
    const updates = [
      ...names.map((n, i) => message({ document: { file_id: `f${i}`, file_unique_id: `u${i}`, file_name: n } })),
      message({ text: "Why did revenue fall?" }),
    ];
    let polls = 0;
    const bot = createBot("123:fake", api, {
      botInfo: {
        id: 1,
        is_bot: true,
        first_name: "AA",
        username: "aa_bot",
        can_join_groups: false,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
      } as never,
      download: async (path) => files[path] as Uint8Array,
    });
    bot.api.config.use(async (_prev, method, payload) => {
      const p = payload as Record<string, unknown>;
      calls.push({ method, payload: p });
      const ok = (result: unknown) => ({ ok: true as const, result }) as never;
      switch (method) {
        case "deleteWebhook":
          return ok(true);
        case "getUpdates":
          // First poll: everything the user sent. Second poll: the work is done, so stop polling.
          if (polls++ === 0) return ok(updates);
          void bot.stop();
          return ok([]);
        case "getFile": {
          const i = Number(String(p.file_id).slice(1));
          return ok({ file_id: p.file_id, file_unique_id: `u${i}`, file_path: names[i] });
        }
        case "sendMessage":
        case "sendDocument":
          return ok({ message_id: ++messageId, date: 0, chat, text: p.text });
        default:
          return ok(true);
      }
    });
    await bot.start();
    const sent = calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));
    expect(sent.filter((t) => t.startsWith("Got "))).toHaveLength(names.length);
    expect(sent).toContain(`Starting: ${names.length} file(s)…`);
    const edits = calls.filter((c) => c.method === "editMessageText");
    expect(new Set(edits.map((c) => c.payload.message_id)).size).toBe(1);
    expect(edits.map((c) => c.payload.text)).toContain("Verifying every number…");
    expect(edits.at(-1)?.payload.text).toBe("Done.");
    const summary = sent.find((t) => t.includes("Findings:")) ?? "";
    expect(summary).not.toMatch(/\{\{N\d+\}\}/);
    expect(summary).toContain("Note: some metric definitions were assumed");
    const doc = calls.find((c) => c.method === "sendDocument");
    expect(doc?.payload.caption).toMatch(/^Full report · job /);
    // The job really used auto_confirm and the question as its objective.
    const [job] = await manager.list();
    expect(job?.status).toBe("done");
    expect((await manager.report(job?.job_id as string)).objective.text).toBe("Why did revenue fall?");
  }, 180_000);
});
