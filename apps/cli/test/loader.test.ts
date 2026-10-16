// The CLI runs the TypeScript sources through tsx from the repo root, not through vitest's transform. A JSX
// setting that only vitest supplies once broke RENDER in `aa` ("React is not defined"), so render under tsx here.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..", "..");

describe("sources under the CLI's loader", () => {
  it("renders report.html through tsx from the repo root", () => {
    const code = `
      import { readFileSync } from "node:fs";
      const { renderReportHtml } = await import("./packages/report/src/index.ts");
      const report = JSON.parse(readFileSync("packages/schema/test/fixtures/report.coffee-roaster.json", "utf8"));
      process.stdout.write(renderReportHtml(report).slice(0, 15));
    `;
    const out = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { cwd: root, encoding: "utf8" });
    expect(out).toBe("<!doctype html>");
  }, 60_000);
});
