// The MCP door (interfaces §3): five tools and two resources over the job manager. A calling model gets verified
// numbers with their provenance; every tool description tells it to quote them, never recalculate them.
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import type { JobManager, JobStatus } from "@agentic-analytics/core";
import { fillPlaceholders, reportSummaryText } from "@agentic-analytics/report";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const VERIFIED =
  "Numbers in the result are verified facts computed by the engine (SQL or deterministic code) with provenance. Quote them exactly as given; never recalculate, round differently or derive new numbers from them.";

export interface McpOptions {
  /** Today's date for new jobs (default: the current date). */
  readonly today?: () => string;
  readonly version?: string;
  /**
   * Where `analyze_files` may read: "any" (stdio: the caller is the user's own client) or a list of folders. Over HTTP
   * the default is none, so a caller that can reach /mcp can't read the server's files (set AA_MCP_ROOTS to allow).
   */
  readonly roots?: "any" | readonly string[];
}

/** Thrown when a path is outside the allowed roots (or local paths are off). */
export class PathNotAllowedError extends Error {
  readonly code = "PATH_NOT_ALLOWED";
}

/** The real path of `p` when it lies inside one of `roots` (after resolving symlinks), else a PathNotAllowedError. */
export function allowedPath(p: string, roots: "any" | readonly string[]): string {
  if (roots === "any") return resolve(p);
  if (!roots.length)
    throw new PathNotAllowedError("local paths are off for this server: upload the files through POST /v1/jobs, or set AA_MCP_ROOTS");
  let real: string;
  try {
    real = realpathSync(resolve(p));
  } catch {
    throw new PathNotAllowedError("path not found or not allowed");
  }
  const inside = roots.some((r) => {
    const root = realpathSync(resolve(r));
    return real === root || real.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
  });
  if (!inside) throw new PathNotAllowedError("path not found or not allowed");
  return real;
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));
const fail = (err: unknown) => ({
  ...text(err instanceof Error ? `${"code" in err ? `${String(err.code)}: ` : ""}${err.message}` : String(err)),
  isError: true,
});

const MAX_FILES = 500;

/** Files under the given paths: symlinks are skipped (no cycles, no escaping the folder), at most MAX_FILES. */
function collect(p: string, out: string[] = []): string[] {
  const st = lstatSync(p);
  if (st.isSymbolicLink()) return out;
  if (st.isDirectory()) for (const n of readdirSync(p).sort()) collect(join(p, n), out);
  else if (st.isFile()) out.push(p);
  if (out.length > MAX_FILES) throw new Error(`more than ${MAX_FILES} files under the given paths; point at a smaller folder`);
  return out;
}

export function createMcpServer(manager: JobManager, o: McpOptions = {}): McpServer {
  const server = new McpServer({ name: "agentic-analytics", version: o.version ?? "0.0.0" });
  const today = o.today ?? (() => new Date().toISOString().slice(0, 10));

  const describeStatus = async (s: JobStatus) => {
    if (s.status === "done") return `${s.job_id}: done\n\n${reportSummaryText(await manager.report(s.job_id))}`;
    if (s.status === "awaiting_confirmation") {
      const m = await manager.metrics(s.job_id);
      return `${s.job_id}: waiting for metric confirmation. Review these definitions with the user, then call confirm_metrics with the (edited) YAML:\n\n${m.metrics.map((x) => `- ${x.text}`).join("\n")}\n\n${m.yaml}`;
    }
    if (s.status === "failed") return `${s.job_id}: failed at ${s.error?.stage ?? "?"}: ${s.error?.code}: ${s.error?.message}`;
    return `${s.job_id}: ${s.status}${s.stage ? ` (${s.stage})` : ""}`;
  };

  server.registerTool(
    "analyze_files",
    {
      title: "Analyze business files",
      description: `Start an analysis job on local files or folders (spreadsheets, CSV, PDF, Word, email). Returns the job id and status; with wait=true, waits and returns the report summary. ${VERIFIED}`,
      inputSchema: {
        paths: z.array(z.string()).min(1).describe("Absolute paths of files or folders on this machine"),
        objective: z.string().optional().describe("The business goal recommendations are ranked by"),
        web: z.boolean().optional().describe("Allow sanitized web searches for context (off by default)"),
        small_model: z.boolean().optional(),
        auto_confirm: z.boolean().optional().describe("Keep drafted metric definitions as assumptions (default true)"),
        currency: z.string().length(3).optional(),
        wait: z.boolean().optional().describe("Wait for the job to finish and return the summary"),
      },
    },
    async (a) => {
      try {
        const roots = o.roots ?? "any";
        // Each file is checked again at read time: collect skips symlinks, and the real path must stay inside a root.
        const files = a.paths
          .flatMap((p) => collect(allowedPath(p, roots)))
          .map((p) => ({ name: basename(p), bytes: new Uint8Array(readFileSync(allowedPath(p, roots))) }));
        const s = await manager.create(files, {
          today: today(),
          ...(a.currency ? { currency: a.currency.toUpperCase() } : {}),
          ...(a.objective ? { objective: a.objective } : {}),
          ...(a.web ? { web: true } : {}),
          ...(a.small_model ? { smallModel: true } : {}),
          autoConfirm: a.auto_confirm ?? true,
        });
        return text(await describeStatus(a.wait ? await manager.wait(s.job_id) : s));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "get_report",
    {
      title: "Get a report",
      description: `The report of a job: format=summary (headline, top findings and recommendations, as text) or json (the full verified report.json with facts, citations and verification). ${VERIFIED}`,
      inputSchema: { job_id: z.string(), format: z.enum(["summary", "json"]).optional() },
    },
    async (a) => {
      try {
        const s = await manager.status(a.job_id);
        if (s.status !== "done") return text(await describeStatus(s));
        const r = await manager.report(a.job_id);
        return a.format === "json" ? json(r) : text(reportSummaryText(r, { findings: 5, recommendations: 5 }));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "confirm_metrics",
    {
      title: "Confirm metric definitions",
      description:
        "Confirm (or edit) the metric definitions of a job waiting for confirmation, as YAML; the job resumes. Invalid definitions are refused with reasons.",
      inputSchema: { job_id: z.string(), yaml: z.string() },
    },
    async (a) => {
      try {
        return text(await describeStatus(await manager.confirm(a.job_id, a.yaml)));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "ask_report",
    {
      title: "Ask about a report",
      description: `Ask a follow-up question about a finished report. The answer is claims that passed the same verification as the report, with their facts and citations; claims that failed are listed as dropped. ${VERIFIED}`,
      inputSchema: { job_id: z.string(), question: z.string().min(3).max(500) },
    },
    async (a) => {
      try {
        const r = await manager.ask(a.job_id, a.question);
        return json({
          answer: r.claims.map((c) => fillPlaceholders(c.text, r.facts)),
          claims: r.claims,
          facts: r.facts,
          dropped: r.dropped,
          ...(r.notCovered ? { not_covered: r.notCovered } : {}),
        });
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "explain_number",
    {
      title: "Explain a number",
      description: `Show how one number in a report was computed: its SQL and parameters (or function and inputs), the metric definition, and the input rows. ${VERIFIED}`,
      inputSchema: { job_id: z.string(), fact_id: z.string().regex(/^N\d+$/) },
    },
    async (a) => {
      try {
        return json(await manager.explain(a.job_id, a.fact_id));
      } catch (err) {
        return fail(err);
      }
    },
  );

  const list = async () => ({
    resources: (await manager.list())
      .filter((s) => s.status === "done")
      .map((s) => ({ uri: `report://${s.job_id}`, name: `report ${s.job_id}`, mimeType: "application/json" })),
  });
  server.registerResource(
    "report",
    new ResourceTemplate("report://{job_id}", { list }),
    { title: "Verified report (JSON)", mimeType: "application/json", description: VERIFIED },
    async (uri, v) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await manager.report(String(v.job_id)), null, 2) }],
    }),
  );
  server.registerResource(
    "report-html",
    new ResourceTemplate("report-html://{job_id}", { list: undefined }),
    { title: "Report (HTML)", mimeType: "text/html" },
    async (uri, v) => ({ contents: [{ uri: uri.href, mimeType: "text/html", text: await manager.reportHtml(String(v.job_id)) }] }),
  );
  return server;
}
