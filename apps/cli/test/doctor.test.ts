import { describe, expect, it } from "vitest";
import { checkNode, type DoctorDeps, exitCode, formatReport, runDoctor } from "../src/doctor.ts";

/** Stub fetch: answers only the URLs in `routes`, everything else is "connection refused". No network. */
function stubFetch(routes: Record<string, unknown>, seen: { url: string; auth?: string }[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    seen.push(headers.authorization ? { url, auth: headers.authorization } : { url });
    if (url in routes) return new Response(JSON.stringify(routes[url]), { status: 200 });
    throw new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") });
  }) as typeof fetch;
}

const base = (over: Partial<DoctorDeps> = {}): DoctorDeps => ({
  nodeVersion: "v22.13.0",
  duckdbVersion: async () => "v1.5.6",
  fetch: stubFetch({}),
  env: {},
  ...over,
});

describe("aa doctor", () => {
  it("passes with Node and DuckDB even when no provider or service is reachable", async () => {
    const results = await runDoctor(base());
    const byName = Object.fromEntries(results.map((r) => [r.name, r]));
    expect(byName.node?.status).toBe("ok");
    expect(byName.duckdb?.detail).toBe("v1.5.6");
    expect(byName.ollama?.status).toBe("missing");
    expect(byName.searxng?.status).toBe("missing");
    expect(byName.docling?.status).toBe("missing");
    expect(exitCode(results)).toBe(0);
    const text = formatReport(results);
    expect(text).toContain("v22.13.0");
    expect(text).toContain("v1.5.6");
    expect(text).toContain("Model providers reachable: none");
  });

  it("lists Ollama models when Ollama answers", async () => {
    const fetch = stubFetch({ "http://ollama:11434/api/tags": { models: [{ name: "qwen3.5:9b" }] } });
    const results = await runDoctor(base({ fetch, env: { OLLAMA_BASE_URL: "http://ollama:11434/" } }));
    const ollama = results.find((r) => r.name === "ollama");
    expect(ollama?.status).toBe("ok");
    expect(ollama?.detail).toContain("qwen3.5:9b");
    expect(formatReport(results)).toContain("Model providers reachable: ollama");
  });

  it("skips openai-compatible endpoints without a key and never calls them", async () => {
    const seen: { url: string }[] = [];
    const results = await runDoctor(base({ fetch: stubFetch({}, seen) }));
    expect(results.find((r) => r.name === "openai-compatible:groq")?.detail).toBe("GROQ_API_KEY not set");
    expect(seen.some((s) => s.url.includes("groq.com"))).toBe(false);
  });

  it("probes an openai-compatible endpoint with its key and does not print the key", async () => {
    const seen: { url: string; auth?: string }[] = [];
    const fetch = stubFetch({ "https://api.groq.com/openai/v1/models": { data: [{ id: "a" }, { id: "b" }] } }, seen);
    const results = await runDoctor(base({ fetch, env: { GROQ_API_KEY: "secret-123" } }));
    expect(results.find((r) => r.name === "openai-compatible:groq")?.detail).toBe("reachable, 2 model(s) listed");
    expect(seen.find((s) => s.url.includes("groq.com"))?.auth).toBe("Bearer secret-123");
    expect(formatReport(results)).not.toContain("secret-123");
  });

  it("fails (exit 1) when DuckDB cannot start", async () => {
    const results = await runDoctor(
      base({
        duckdbVersion: async () => {
          throw new Error("binding not found");
        },
      }),
    );
    expect(results.find((r) => r.name === "duckdb")?.status).toBe("error");
    expect(exitCode(results)).toBe(1);
  });

  it("requires Node 22 or newer", () => {
    expect(checkNode("v22.0.0").status).toBe("ok");
    expect(checkNode("v24.1.0").status).toBe("ok");
    expect(checkNode("v20.11.1").status).toBe("error");
  });
});
