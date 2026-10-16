import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parse } from "yaml";
import {
  aggregateOrders,
  coffeeRoasterFiles,
  EMAIL_BODY,
  EMAIL_EML,
  generateOrders,
  goldenReportJson,
  hotelGroupName,
  MONTHS,
  opsNotesText,
  pageText,
  refundCents,
} from "../src/index.ts";

const dir = join(import.meta.dirname, "..", "coffee-roaster-v1");
const answers = parse(readFileSync(join(dir, "answers.yaml"), "utf8")) as {
  monthly: { month: string; revenue: number; orders: number; wholesale: number; retail: number; refund_rate_pct: number }[];
};

describe("coffee-roaster-v1 dataset", () => {
  it("committed files equal a fresh deterministic build", () => {
    for (const [name, data] of Object.entries(coffeeRoasterFiles())) {
      const committed = readFileSync(join(dir, "files", name));
      expect(createHash("sha256").update(committed).digest("hex"), name).toBe(createHash("sha256").update(data).digest("hex"));
    }
  });

  it("answers.yaml monthly table equals the generator's ground truth", () => {
    expect(answers.monthly).toEqual(
      MONTHS.map((m) => ({
        month: m.month,
        revenue: m.revenueCents / 100,
        orders: m.orders,
        wholesale: m.wholesaleCents / 100,
        retail: m.retailCents / 100,
        refund_rate_pct: m.refundPermille / 10,
      })),
    );
  });

  it("Orders sheet aggregates exactly to the Monthly sheet", () => {
    const wb = XLSX.read(readFileSync(join(dir, "files", "sales-2026.xlsx")));
    const orders = XLSX.utils.sheet_to_json<Record<string, string | number>>(wb.Sheets.Orders as XLSX.WorkSheet);
    const byMonth = new Map<string, { revenue: number; orders: number; wholesale: number; refunds: number }>();
    for (const o of orders) {
      const [, mm, yyyy] = String(o.Date).split("/");
      const k = `${yyyy}-${mm}`;
      const acc = byMonth.get(k) ?? { revenue: 0, orders: 0, wholesale: 0, refunds: 0 };
      const cents = Math.round(Number(o.Amount) * 100);
      if (o.Status === "refunded") acc.refunds += cents;
      else {
        acc.revenue += cents;
        acc.orders += 1;
        if (o.Channel === "wholesale") acc.wholesale += cents;
      }
      byMonth.set(k, acc);
    }
    const monthly = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets.Monthly as XLSX.WorkSheet, { header: 1, range: "B2:F7" });
    MONTHS.forEach((m, i) => {
      const agg = byMonth.get(m.month);
      // e.g. January: revenue 41,200.00 = 4,120,000 cents; refunds 1.1% × 41,200 = 453.20 = 45,320 cents
      expect(agg).toEqual({ revenue: m.revenueCents, orders: m.orders, wholesale: m.wholesaleCents, refunds: refundCents(m) });
      expect(monthly[i]).toEqual([m.revenueCents / 100, m.orders, m.wholesaleCents / 100, m.retailCents / 100, m.refundPermille / 1000]);
    });
  });

  it("in-memory aggregation agrees with the generator", () => {
    const agg = aggregateOrders(generateOrders());
    expect(agg.get("2026-04")?.wholesale).toBe(740_000); // Hotel Group gone: 15,900 − 8,500 = 7,400
  });

  it("plants the hotel group under two spellings and pauses it from April", () => {
    const names = new Set(
      generateOrders()
        .filter((o) => o.customer.includes("Hotel Group"))
        .map((o) => `${o.date.slice(3)}|${o.customer}`),
    );
    expect([...names].sort()).toEqual(["01/2026|OOO Hotel Group", "02/2026|OOO Hotel Group", "03/2026|Hotel Group LLC"]);
    expect(hotelGroupName("2026-04")).toBe("Hotel Group LLC");
  });

  it("plants the ×1000 packaging typo at Monthly!J3", () => {
    const wb = XLSX.read(readFileSync(join(dir, "files", "sales-2026.xlsx")));
    expect((wb.Sheets.Monthly as XLSX.WorkSheet).J3?.v).toBe(1_240_000);
  });

  it("dates are dd/mm/yyyy text with both ambiguous and unambiguous days", () => {
    const days = generateOrders().map((o) => Number(o.date.slice(0, 2)));
    expect(days.some((d) => d <= 12)).toBe(true);
    expect(days.some((d) => d > 12)).toBe(true);
  });

  it("documents contain the cited passages", () => {
    expect(pageText(2)).toContain("Wholesale prices increase 12% from 15 March 2026.");
    expect(EMAIL_EML).toContain("After the new price list we are pausing our standing order while we compare suppliers.");
    expect(opsNotesText()).toContain("Switched to the new packaging supplier on 28 April.");
  });
});

describe("golden report fixture", () => {
  it("the committed fixture equals a fresh build from the dataset", () => {
    const committed = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "packages", "schema", "test", "fixtures", "report.coffee-roaster.json"),
      "utf8",
    );
    expect(committed).toBe(goldenReportJson());
  });

  it("every quote is in its source text and spans point at it", () => {
    const report = JSON.parse(goldenReportJson()) as { sources: { id: string; locator: { char_start?: number; char_end?: number } }[] };
    const texts: Record<string, string> = { S2: pageText(2), S3: EMAIL_BODY, S4: opsNotesText() };
    for (const [id, text] of Object.entries(texts)) {
      const loc = report.sources.find((s) => s.id === id)?.locator;
      expect(loc?.char_start).toBeDefined();
      expect(text.slice(loc?.char_start, loc?.char_end).length).toBeGreaterThan(20);
    }
    expect(pageText(2).slice(report.sources[1]?.locator.char_start, report.sources[1]?.locator.char_end)).toBe(
      "Wholesale prices increase 12% from 15 March 2026.",
    );
  });
});
