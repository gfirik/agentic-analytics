// Mechanical checks for AGENTS.md rules that are easy to break by accident.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const SKIP = new Set(["node_modules", ".git", ".turbo", "dist", "out", "files", "fixtures", "json"]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(relative(root, p));
  }
  return out;
}

const files = ["packages", "apps", "evals", "scripts"].flatMap((d) => sourceFiles(join(root, d)));

describe("repo boundaries", () => {
  it("imports the AI SDK only inside packages/models (AGENTS.md §3)", () => {
    const offenders = files.filter(
      (f) => !f.startsWith("packages/models/") && /from\s+["'](ai|@ai-sdk\/[^"']+)["']/.test(readFileSync(join(root, f), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("depends on no paid-provider SDKs before M13 (AGENTS.md §2.3)", () => {
    const manifests = ["package.json"];
    for (const dir of ["packages", "apps", "evals"]) {
      for (const name of readdirSync(join(root, dir))) {
        const manifest = join(dir, name, "package.json");
        if (existsSync(join(root, manifest))) manifests.push(manifest);
      }
    }
    const paid = /"(@ai-sdk\/(anthropic|openai|google|mistral|cohere|azure|amazon-bedrock)|openai|@anthropic-ai\/sdk)"\s*:/;
    expect(manifests.filter((m) => paid.test(readFileSync(join(root, m), "utf8")))).toEqual([]);
  });

  it("has no console.log in library packages (AGENTS.md §4)", () => {
    const offenders = files.filter(
      (f) => f.startsWith("packages/") && f.includes("/src/") && /console\.log\(/.test(readFileSync(join(root, f), "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
