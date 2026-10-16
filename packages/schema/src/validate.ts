import { checkReportIntegrity, type IntegrityIssue } from "./integrity.ts";
import { Report } from "./report.ts";

export type ReportValidation = { ok: true; report: Report } | { ok: false; issues: IntegrityIssue[] };

/** Validates unknown JSON as a report v1: Zod shape first, then cross-reference integrity. */
export function validateReport(input: unknown): ReportValidation {
  const parsed = Report.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })) };
  }
  const issues = checkReportIntegrity(parsed.data);
  return issues.length ? { ok: false, issues } : { ok: true, report: parsed.data };
}
