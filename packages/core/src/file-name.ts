// Input file names come from uploads, MCP calls and the command line. One rule for every door (interfaces §1,
// "Uploads"): the manager cleans a name to it, and runJob refuses any name the rule would change.

/** NAME_MAX on ext4, APFS and NTFS: a longer name fails with ENAMETOOLONG instead of being written. */
export const MAX_NAME_BYTES = 255;
// An "extension" longer than this is part of the name, so a long dotted name is shortened in its middle, not lost.
const MAX_EXT_BYTES = 32;
// NUL makes Node's fs throw; the other control characters (C0, DEL and C1, which holds the 8-bit CSI) break logs and
// terminals that show the name, and the bidi overrides and isolates can hide a name's real extension.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

const bytes = (s: string) => new TextEncoder().encode(s).length;

/** The longest prefix of `s` within `max` UTF-8 bytes, cut between code points. */
function cut(s: string, max: number): string {
  let out = "";
  for (const ch of s) {
    if (bytes(out + ch) > max) break;
    out += ch;
  }
  return out;
}

/**
 * The plain file name for `raw`: its base name with control characters removed, `fallback` for an empty, `.` or
 * `..` name, and at most MAX_NAME_BYTES bytes with the extension kept. `suffix` (e.g. " (2)") goes before the
 * extension and counts toward the limit.
 */
export function cleanFileName(raw: string, fallback: string, suffix = ""): string {
  let name = raw.replace(CONTROL, "").split(/[\\/]/).pop() ?? "";
  if (!name || name === "." || name === "..") name = fallback;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && bytes(name.slice(dot)) <= MAX_EXT_BYTES ? name.slice(dot) : "";
  const stem = ext ? name.slice(0, dot) : name;
  return `${cut(stem, MAX_NAME_BYTES - bytes(suffix + ext))}${suffix}${ext}`;
}
