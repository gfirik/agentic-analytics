// Report wording for files that were not read: each names the file and the fix, with no free numeral.
import { FILE_NOT_READ_KINDS, findFreeNumerals } from "@agentic-analytics/schema";
import { describe, expect, it } from "vitest";
import { fileIssueText } from "../src/file-issues.ts";

describe("file rejection wording", () => {
  it("a gzip file: says gzip, names the file, tells the owner to unzip it", () => {
    const t = fileIssueText("archive_rejected", "gzip", "reviews.csv.gz");
    expect(t).toContain("“reviews.csv.gz”");
    expect(t).toContain("gzip-compressed");
    expect(t).toContain("gunzip");
  });

  it("a control-character file: names the cause and says to save as UTF-8", () => {
    const t = fileIssueText("unsupported_type", "nul_bytes", "form10k_2023.txt");
    expect(t).toContain("“form10k_2023.txt”");
    expect(t).toMatch(/NUL or other control characters/);
    expect(t).toContain("“UTF-16”");
    expect(t).toContain("plain “UTF-8” text");
  });

  it("a too-large file: names the file, which limit, and the ways to shrink it", () => {
    const perFile = fileIssueText("too_large", "file_limit", "reviews.csv");
    const perJob = fileIssueText("too_large", "job_limit", "reviews.csv");
    for (const t of [perFile, perJob]) {
      expect(t).toContain("“reviews.csv”");
      expect(t).toContain("Drop the columns");
      expect(t).toContain("filter to the period");
      expect(t).toContain("split the file");
    }
    expect(perFile).toContain("per-file");
    expect(perJob).toContain("per-job");
  });

  it("every rejection kind has plain wording without a generated fallback or a free numeral", () => {
    for (const kind of FILE_NOT_READ_KINDS)
      for (const cause of [undefined, "gzip", "zip", "nul_bytes", "not_utf8", "file_limit", "job_limit", "unpacked_limit"]) {
        const t = fileIssueText(kind, cause, "a1.csv");
        expect(t, `${kind}/${cause}`).toBeTruthy();
        expect(t).not.toMatch(/Data issue/);
        expect(findFreeNumerals(t ?? "")).toEqual([]);
      }
  });
});
