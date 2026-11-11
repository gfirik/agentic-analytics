// Report wording for files that were not read (ingestion spec §1, report-schema §3). Each sentence names the file
// (quoted: file names carry digits, and so do names such as “UTF-8”) and what the owner should do. No sizes: a size would be a free numeral.
import { q } from "./claims.ts";

/** The ingestion issue kinds that mean "this file was not read". */
export const FILE_ISSUE_KINDS: ReadonlySet<string> = new Set([
  "archive_rejected",
  "unsupported_type",
  "unreadable_file",
  "password_protected",
  "too_large",
]);

const TOO_LARGE_FIX =
  "Drop the columns the analysis does not need (free-text columns such as comments make files big), filter to the period you need, or split the file, then add it again.";

/** One plain sentence for a rejected file, or undefined when the kind is not a file rejection. */
export function fileIssueText(kind: string, cause: string | undefined, file: string): string | undefined {
  const f = file ? q(file) : "A file";
  switch (kind) {
    case "archive_rejected":
      return cause === "gzip"
        ? `${f} is gzip-compressed, which this version does not read. Unzip it first (for example with gunzip) and add the file inside it.`
        : `${f} is an archive, which this version does not read. Unpack it and add the files inside it.`;
    case "unsupported_type":
      if (cause === "nul_bytes")
        return `${f} was not read: it contains NUL or other control characters, so it looks binary or is saved as “UTF-16”. Save it as plain “UTF-8” text and add it again.`;
      if (cause === "not_utf8") return `${f} was not read: it is not valid “UTF-8” text. Save it as plain “UTF-8” text and add it again.`;
      if (cause === "legacy_doc") return `${f} is an old .doc file, which this version does not read. Save it as .docx and add it again.`;
      return `${f} was not read: its file type is not supported. Save it as a spreadsheet (xlsx or csv), a PDF, a DOCX or plain text and add it again.`;
    case "unreadable_file":
      return `${f} could not be read; it may be damaged. Check that it opens in its own program, then add it again.`;
    case "password_protected":
      return `${f} is password-protected and was not read. Remove the password and add it again.`;
    case "too_large":
      if (cause === "file_limit") return `${f} is over the per-file size limit and was not read. ${TOO_LARGE_FIX}`;
      if (cause === "job_limit")
        return `${f} did not fit in the per-job size limit (the files before it used it up) and was not read. ${TOO_LARGE_FIX}`;
      return `${f} is too large once unpacked and was not read. ${TOO_LARGE_FIX}`;
    default:
      return undefined;
  }
}
