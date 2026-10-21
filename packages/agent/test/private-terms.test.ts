// What must never leave the machine through a web query (security spec §5): names and addresses that appear only in
// an email's headers, and actors the extractor found, count as private too, not only table values and body text.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql, Workspace } from "@agentic-analytics/store";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { privateTerms, searchAndStore } from "../src/web.ts";

const dir = mkdtempSync(join(tmpdir(), "aa-private-"));
let ws: Workspace;
beforeAll(async () => {
  ws = await Workspace.open(join(dir, "job.duckdb"));
  await ws.run(sql`INSERT INTO files (id, name, sha256, status) VALUES ('F1', 'board-note.eml', 'x', 'ok')`);
  const meta = JSON.stringify({
    from: "Dilnoza Karimova <dilnoza@example.org>",
    to: '"Rustam Aliev" <rustam@example.org>, ops@example.org, "Usmonov, Bekzod (Sales)" <b@example.org>',
    subject: "Re: Hotel Group standing order",
  });
  await ws.run(
    sql`INSERT INTO sources (id, file_id, kind, text, meta) VALUES ('D1', 'F1', 'email', 'The body names nobody.', ${meta}::JSON)`,
  );
  const payload = JSON.stringify({ id: "E1", kind: "event", text: "a supplier changed terms", actor: "Samarkand Beans LLC" });
  await ws.run(sql`INSERT INTO extracts VALUES ('E1', 'D1', NULL, ${payload}::JSON, false)`);
});
afterAll(async () => {
  await ws.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("privateTerms", () => {
  it("covers email header names and addresses and the extractor's actors", async () => {
    const t = await privateTerms(ws);
    expect(t.names).toEqual(expect.arrayContaining(["Dilnoza Karimova", "Rustam Aliev", "Samarkand Beans LLC"]));
    expect(t.values).toEqual(expect.arrayContaining(["board-note.eml", "dilnoza@example.org", "rustam@example.org", "ops@example.org"]));
    // A bare address is a value, not a name.
    expect(t.names).not.toContain("ops@example.org");
    // A quoted display name with a comma splits into its parts, each private (fail-safe); the subject is a phrase.
    expect(t.names).toEqual(expect.arrayContaining(["Usmonov", "Bekzod (Sales)", "Hotel Group standing order"]));
  });

  it("is recomputed at each search, so an actor extracted after the lane was set up is still stripped", async () => {
    const sent: string[] = [];
    const lane = {
      provider: {
        id: "fake",
        search: async (q: string) => {
          sent.push(q);
          return [];
        },
      },
      terms: { names: [] },
    };
    const payload = JSON.stringify({ id: "E2", kind: "event", text: "a late find", actor: "Bukhara Roasters" });
    await ws.run(sql`INSERT INTO extracts VALUES ('E2', 'D1', NULL, ${payload}::JSON, false)`);
    await searchAndStore(ws, lane, "Bukhara Roasters coffee price trend");
    expect(sent.length).toBe(1);
    expect(sent[0]).not.toMatch(/Bukhara/i);
  });

  it("ignores actors found on web pages: they are public, and a page must not blank out later queries", async () => {
    await ws.run(sql`INSERT INTO sources (id, file_id, kind, external, text) VALUES ('W1', 'WEB', 'web', true, 'page')`);
    const payload = JSON.stringify({ id: "E3", kind: "event", text: "prices rose", actor: "coffee prices" });
    await ws.run(sql`INSERT INTO extracts VALUES ('E3', 'W1', NULL, ${payload}::JSON, false)`);
    expect((await privateTerms(ws)).names).not.toContain("coffee prices");
  });
});
