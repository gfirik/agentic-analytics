// `aa run <paths…>`: one full job (ingest → … → verify → render) in a job folder, with the configured models.
// `aa run --resume <folder>` continues a job that was interrupted. Prints each stage as it starts and ends, then a
// short summary with the paths of the verified report.json and report.html.

import { type JobDeps, type JobOptions, PipelineError, runJob } from "@agentic-analytics/core";
import type { InputFile } from "@agentic-analytics/ingest";
import type { JobEvent } from "@agentic-analytics/schema";

export interface RunCommandInput {
  readonly dir: string;
  /** Files for a new job; empty when resuming. */
  readonly files: readonly InputFile[];
  readonly options?: JobOptions;
}

export function formatEvent(e: JobEvent): string | undefined {
  switch (e.type) {
    case "stage_started":
      return `▸ ${e.stage}`;
    case "stage_completed":
      return `✓ ${e.stage} (${Math.round(e.duration_ms)} ms)`;
    case "failed":
      return `✗ ${e.stage ?? "job"} failed: ${e.error.code}: ${e.error.message}`;
    case "warning":
      return `! ${e.message}`;
    default:
      return undefined;
  }
}

export async function runCommand(
  input: RunCommandInput,
  deps: JobDeps & { out: (line: string) => void; resumeFlags?: readonly string[] },
): Promise<number> {
  let out: Awaited<ReturnType<typeof runJob>>;
  try {
    out = await runJob(
      { dir: input.dir, ...(input.files.length ? { files: input.files } : {}), ...(input.options ? { options: input.options } : {}) },
      {
        ...deps,
        onEvent: (e) => {
          const line = formatEvent(e);
          if (line) deps.out(line);
        },
      },
    );
  } catch (err) {
    if (!(err instanceof PipelineError)) throw err;
    // The stage line (✗ …) is already printed; say how to continue rather than dumping a stack.
    deps.out("");
    deps.out(`The job stopped at ${err.stage}. Completed stages are saved; fix the cause, then continue with:`);
    deps.out(`  aa run --resume ${[input.dir, ...(deps.resumeFlags ?? [])].join(" ")}`);
    return 1;
  }
  const r = out.report;
  deps.out("");
  deps.out(`job ${out.jobId} · ${r.findings.length} finding(s) · ${r.recommendations.length} recommendation(s) · ${r.facts.length} facts`);
  for (const f of r.findings) deps.out(`  ${f.id} ${f.title}`);
  deps.out(`report (verified): ${out.reportPath}`);
  deps.out(`html: ${out.htmlPath}`);
  if (out.run.skipped.length) deps.out(`skipped: ${out.run.skipped.join(", ")}`);
  return 0;
}
