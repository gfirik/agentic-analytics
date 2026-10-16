import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Report, validateReport } from "@agentic-analytics/schema";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import { formatValue, renderReportHtml } from "../src/index.ts";

const fixture = (): Report => {
  const res = validateReport(
    JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "schema", "test", "fixtures", "report.coffee-roaster.json"), "utf8")),
  );
  if (!res.ok) throw new Error(JSON.stringify(res.issues));
  return res.report;
};

const windows: Window[] = [];
afterEach(async () => {
  for (const w of windows.splice(0)) await w.happyDOM.close();
});

/** Loads the rendered HTML in happy-dom with its inline script running, like a browser opened offline. */
async function open(html: string) {
  const window = new Window({
    settings: { enableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  });
  windows.push(window);
  window.document.write(html);
  await window.happyDOM.waitUntilComplete();
  return window.document;
}

describe("formatValue", () => {
  it("formats facts for reading without changing them", () => {
    expect(formatValue(-17.913832199546487, "percent")).toBe("−17.9%");
    expect(formatValue(107.59493670886076, "percent")).toBe("108%");
    expect(formatValue(44100, "currency")).toBe("44,100");
    expect(formatValue(-8500, "currency")).toBe("−8,500");
    expect(formatValue(3995.5, "currency")).toBe("3,995.50");
  });
});

describe("renderReportHtml", () => {
  const html = renderReportHtml(fixture());

  it("is one self-contained offline file", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).not.toMatch(/\s(?:src|href)="https?:/i);
    expect(html).not.toMatch(/<link\b|@import|url\(\s*["']?https?:/i);
    expect(html).toContain("<style>");
  });

  it("substitutes every placeholder with a formatted, clickable number", () => {
    expect(html).not.toContain("{{N");
    for (const shown of ["−17.9%", "108%", "1.2%", "3.4%", "44,100", "36,200", "−8,500", "814"]) expect(html).toContain(shown);
  });

  it("orders sections as the spec requires", () => {
    const order = ["dq", "findings", "recs", "oq", "assumptions", "metrics", "sources", "verification"].map((id) =>
      html.indexOf(`id="${id}"`),
    );
    expect(order.every((pos) => pos > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html.indexOf('class="headline"')).toBeLessThan(order[0] ?? 0);
  });

  it("marks web sources External and shows the high-severity data-quality banner", async () => {
    const doc = await open(html);
    const web = [...doc.querySelectorAll(".cite")].find((b) => b.getAttribute("data-source") === "S5");
    expect(web?.querySelector(".ext")?.textContent).toBe("External");
    expect(doc.querySelector("section.banner h2")?.textContent).toBe("Data-quality warning");
  });

  it("clicking a table citation highlights the cited rows and cells; clicking again clears", async () => {
    const doc = await open(html);
    const cite = [...doc.querySelectorAll(".cite")].find(
      (b) => b.getAttribute("data-rows") === "4,5" && b.getAttribute("data-cells") === "B4,B5",
    );
    expect(cite).toBeDefined();
    (cite as unknown as HTMLElement).click();
    const box = doc.querySelector('.ev[data-source="S1"]');
    expect(box?.hasAttribute("hidden")).toBe(false);
    expect([...doc.querySelectorAll("tr.hl")].map((r) => r.getAttribute("data-row"))).toEqual(["4", "5"]);
    expect([...doc.querySelectorAll("td.hl")].map((c) => c.getAttribute("data-cell"))).toEqual(["B4", "B5"]);
    expect(cite?.getAttribute("aria-pressed")).toBe("true");
    (cite as unknown as HTMLElement).click();
    expect(doc.querySelectorAll(".hl").length).toBe(0);
  });

  it("clicking a document citation highlights the quoted passage", async () => {
    const doc = await open(html);
    const cite = [...doc.querySelectorAll(".cite")].find((b) => b.getAttribute("data-source") === "S3");
    (cite as unknown as HTMLElement).click();
    const marked = doc.querySelector('.ev[data-source="S3"] mark.hl');
    expect(marked?.textContent).toBe("After the new price list we are pausing our standing order while we compare suppliers.");
  });

  it("clicking a number explains its computation; Escape closes it", async () => {
    const doc = await open(html);
    const num = doc.querySelector('.num[data-fact="N4"]') as unknown as HTMLElement;
    num.click();
    const panel = doc.getElementById("aa-fact-panel");
    expect(panel?.hasAttribute("hidden")).toBe(false);
    const text = panel?.textContent ?? "";
    expect(text).toContain("revenue_change_pct_2026-04_vs_2026-03");
    expect(text).toContain("function pct_change");
    expect(text).toContain("N2 = 36,200");
    const sqlNum = doc.querySelector('.num[data-fact="N1"]') as unknown as HTMLElement;
    sqlNum.click();
    expect(panel?.querySelector(".sql")?.textContent).toContain("FROM t_monthly");
    expect(panel?.querySelector(".cite")?.textContent).toContain("sales-2026.xlsx · Monthly r4");
    const win = doc.defaultView as unknown as Window;
    doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape" }));
    expect(panel?.hasAttribute("hidden")).toBe(true);
  });

  it("escapes report text and never lets it become markup", () => {
    const r = fixture();
    if (r.findings[0]) r.findings[0].confidence_reasons = ["<img src=x onerror=alert(1)>"];
    if (r.metrics[0]) r.metrics[0].plain = "</script><script>alert(1)</script>";
    const out = renderReportHtml(r);
    expect(out).not.toContain("<img src=x");
    expect(out).not.toContain("</script><script>alert(1)");
  });
});
