// What the site's copy buttons put on the clipboard (apps/docs/DESIGN.md §6 "Copy", site v5 PR 3): the runnable text,
// with prompts stripped and `\` continuations joined, separate commands kept as separate lines.
import { describe, expect, it } from "vitest";
import { isCopyValue, isShellLanguage, runnableText } from "../../apps/docs/src/components/site/copy.ts";

describe("runnableText", () => {
  it("joins backslash continuations into one runnable line and keeps separate commands on their own lines", () => {
    const raw =
      "bun run aa analyze \\\n  examples/coffee-roaster --open\n# no model yet? replay it offline\nAA_DEMO_MODEL=scripted \\\n  bun run aa analyze \\\n  examples/coffee-roaster \\\n  --yes --embedder hash";
    expect(runnableText(raw, true)).toBe(
      "bun run aa analyze examples/coffee-roaster --open\n# no model yet? replay it offline\nAA_DEMO_MODEL=scripted bun run aa analyze examples/coffee-roaster --yes --embedder hash",
    );
  });

  it("strips a leading $ prompt, trailing spaces and blank edges", () => {
    expect(runnableText("\n$ aa doctor   \n$ aa serve\n\n", true)).toBe("aa doctor\naa serve");
  });

  it("keeps a literal trailing double backslash, and touches nothing in a non-shell block", () => {
    expect(runnableText("echo a\\\\\necho b", true)).toBe("echo a\\\\\necho b");
    expect(runnableText("SELECT 1 \\\n$ x", false)).toBe("SELECT 1 \\\n$ x");
  });

  it("normalises CRLF line endings", () => {
    expect(runnableText("git clone \\\r\n  https://example.org/x\r\ncd x", true)).toBe("git clone https://example.org/x\ncd x");
  });
});

describe("isShellLanguage", () => {
  it("treats shell and unlabelled blocks as shell, and code languages as code", () => {
    for (const l of ["bash", "sh", "", null, undefined, "plaintext", "console"]) expect(isShellLanguage(l)).toBe(true);
    for (const l of ["sql", "json", "yaml", "ts"]) expect(isShellLanguage(l)).toBe(false);
  });
});

describe("isCopyValue", () => {
  it("accepts commands and environment variable names, not identifiers or prose", () => {
    for (const v of ["aa serve", "aa doctor", "bun run aa doctor", "docker compose up", "GROQ_API_KEY", "API_TOKEN"])
      expect(isCopyValue(v), v).toBe(true);
    for (const v of ["aa", "trend.v1", "verified", "PLANNER_MODEL=a|b", "--resume <folder>", "HTTP"]) expect(isCopyValue(v), v).toBe(false);
  });
});
