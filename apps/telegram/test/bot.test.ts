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
import { afterAll, describe, expect, it, vi } from "vitest";
import { ApiClient, chatPolicy, createBot } from "../src/index.ts";

const root = mkdtempSync(join(tmpdir(), "aa-tg-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const manager = new JobManager({ root, model: coffeePlanner(), deps: () => ({ model: coffeePlanner(), embedder: hashEmbedder() }) });
const app = createApp(manager, { today: () => "2026-07-01", token: "t0k", allowedHosts: ["engine.local"] });
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
      allowedChats: [42],
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
    // Jobs run outside the update loop: wait for this one to finish.
    await bot.idle();
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

  it("answers only allowed chats", async () => {
    const replies: string[] = [];
    const bot = createBot("123:fake", api, {
      botInfo: { id: 1, is_bot: true, first_name: "AA", username: "aa_bot" } as never,
      allowedChats: [7],
    });
    bot.api.config.use(async (_prev, method, payload) => {
      if (method === "sendMessage") replies.push(String((payload as { text: string }).text));
      return { ok: true as const, result: { message_id: 1, date: 0, chat } } as never;
    });
    await bot.handleUpdate(message({ text: "Why did revenue fall?" }) as never);
    expect(replies).toEqual(["This bot is private. Its owner can allow chat 42 in TELEGRAM_ALLOWED_CHATS."]);
  });

  it("a failing update goes to onError and a generic reply; the bot keeps handling updates", async () => {
    const replies: string[] = [];
    const errors: unknown[] = [];
    const bot = createBot("123:fake", api, {
      botInfo: { id: 1, is_bot: true, first_name: "AA", username: "aa_bot" } as never,
      allowedChats: [42],
      onError: (e) => errors.push(e),
    });
    let calls = 0;
    bot.api.config.use(async (_prev, method, payload) => {
      // The first reply fails (as a Telegram 400 would); later ones succeed.
      if (method === "sendMessage" && calls++ === 0) throw new Error("Bad Request: message is too long at /internal/path");
      if (method === "sendMessage") replies.push(String((payload as { text: string }).text));
      return { ok: true as const, result: { message_id: 1, date: 0, chat } } as never;
    });
    // Long polling hands a failing update to bot.errorHandler (set by bot.catch) and carries on; handleUpdate rethrows.
    await bot
      .handleUpdate(message({ text: "/help", entities: [{ type: "bot_command", offset: 0, length: 5 }] }) as never)
      .catch((e: unknown) => bot.errorHandler(e as never));
    expect(errors).toHaveLength(1);
    // The generic reply is sent without blocking the error handler: wait for it.
    await vi.waitFor(() => expect(replies).toEqual(["Something went wrong (details are in the bot's log)."]));
    await bot.handleUpdate(message({ text: "/help", entities: [{ type: "bot_command", offset: 0, length: 5 }] }) as never);
    expect(replies).toHaveLength(2);
  });

  it("refuses to start without an allowlist unless TELEGRAM_PUBLIC=1", () => {
    expect(chatPolicy({})).toHaveProperty("error");
    expect(chatPolicy({ TELEGRAM_ALLOWED_CHATS: "42, -100" })).toEqual({ allowedChats: [42, -100] });
    expect(chatPolicy({ TELEGRAM_PUBLIC: "1" })).toEqual({ allowedChats: [] });
    // Junk values are dropped; nothing usable left means no allowlist.
    expect(chatPolicy({ TELEGRAM_ALLOWED_CHATS: "abc, 0, 4.5, ,42x" })).toHaveProperty("error");
    expect(chatPolicy({ TELEGRAM_ALLOWED_CHATS: "abc, 42" })).toEqual({ allowedChats: [42] });
  });
});

/** A bot over a fake Bot API: records every call, serves the coffee files by name, and lets a test feed updates. */
function harness(o: Parameters<typeof createBot>[2] = {}, client: ApiClient = api) {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const bot = createBot("123:fake", client, {
    botInfo: { id: 1, is_bot: true, first_name: "AA", username: "aa_bot" } as never,
    download: async (path) => files[path] as Uint8Array,
    allowedChats: [42],
    ...o,
  });
  bot.api.config.use(async (_prev, method, payload) => {
    const p = payload as Record<string, unknown>;
    calls.push({ method, payload: p });
    if (method === "getFile")
      return { ok: true as const, result: { file_id: p.file_id, file_unique_id: "u", file_path: p.file_id } } as never;
    return { ok: true as const, result: { message_id: ++messageId, date: 0, chat, text: p.text } } as never;
  });
  const doc = (name: string, extra: Record<string, unknown> = {}) =>
    bot.handleUpdate(message({ document: { file_id: name, file_unique_id: name, file_name: name }, ...extra }) as never);
  const text = (t: string) => bot.handleUpdate(message({ text: t }) as never);
  const sent = () => calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));
  const edits = () => calls.filter((c) => c.method === "editMessageText").map((c) => String(c.payload.text));
  return { bot, calls, doc, text, sent, edits };
}

describe("Telegram bot: limits, albums and concurrency", () => {
  it("an album with one caption runs one job on all its files, once the album is complete", async () => {
    const h = harness({ albumWaitMs: 50 });
    const [first, ...rest] = names;
    await h.doc(first as string, { media_group_id: "g1", caption: "Why did revenue fall?" });
    for (const n of rest) await h.doc(n, { media_group_id: "g1" });
    await h.bot.idle();
    expect(h.sent()).toContain(`Starting: ${names.length} file(s)…`);
    expect(h.edits().at(-1)).toBe("Done.");
  }, 180_000);

  it("a caption on a single file starts the job at once; a second job in the same chat waits its turn", async () => {
    const h = harness();
    const [first] = names;
    await h.doc(first as string, { caption: "What changed?" });
    // While that job runs, the same chat can't start another.
    await h.doc(first as string);
    await h.text("And this?");
    expect(h.sent()).toContain("A job is already running for this chat. Send the next files when it finishes.");
    // The update loop is free meanwhile: /help is answered before the job ends.
    await h.bot.handleUpdate(message({ text: "/help", entities: [{ type: "bot_command", offset: 0, length: 5 }] }) as never);
    expect(h.sent().some((t) => t.startsWith("Send me your business files"))).toBe(true);
    await h.bot.idle();
    expect(h.sent()).toContain("Starting: 1 file(s)…");
  }, 180_000);

  it("caps files and bytes per job, refuses a question over 500 characters, and keeps the files", async () => {
    const h = harness({ maxFiles: 1, maxBytes: 10 * 1024 * 1024 });
    const [a, b] = names;
    await h.doc(a as string);
    await h.doc(b as string);
    expect(h.sent()).toContain("That's the most files one job takes; send your question or /analyze.");
    await h.text("x".repeat(501));
    expect(h.sent()).toContain("That question is 501 characters; the most is 500. Send a shorter one (your files are kept).");
    const tiny = harness({ maxBytes: 10 });
    await tiny.doc(a as string);
    expect(tiny.sent()).toContain("That would be over 0 MB for one job; send your question or /analyze.");
    expect(tiny.calls.some((c) => c.method === "editMessageText")).toBe(false);
  });

  it("forgets files after the waiting time, and limits how many chats may hold files", async () => {
    const h = harness({ pendingTtlMs: -1 });
    await h.doc(names[0] as string);
    await h.text("/analyze");
    await h.bot.handleUpdate(message({ text: "/analyze", entities: [{ type: "bot_command", offset: 0, length: 8 }] }) as never);
    expect(h.sent()).toContain("Send one or more files first.");
    const full = harness({ maxPendingChats: 0 });
    await full.doc(names[0] as string);
    expect(full.sent()).toContain("The bot is holding files for too many chats right now; try again later.");
  });

  it("a failed job shows its code only; the message goes to onError", async () => {
    const errors: unknown[] = [];
    const failing = Object.assign(Object.create(api) as ApiClient, {
      createJob: async () => "job-x",
      follow: async () => ({ type: "failed", error: { code: "STAGE_FAILED", message: "at /home/owner/secret.xlsx" } }),
    });
    const h = harness({ onError: (e) => errors.push(e) }, failing);
    await h.doc(names[0] as string, { caption: "Why?" });
    await h.bot.idle();
    expect(h.edits().at(-1)).toBe("Stopped: STAGE_FAILED (details are in the bot's log)");
    expect(h.edits().join(" ")).not.toContain("secret");
    expect(String(errors[0])).toContain("secret.xlsx");
  });
});
