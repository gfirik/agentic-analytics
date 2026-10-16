// Structured logging (AGENTS.md §4): JSON records to an injected sink, never console.log in library code.
// Logs carry ids, stages and counts, never raw cell values or document text (security spec §6).

export type Level = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  readonly level: Level;
  readonly msg: string;
  readonly at: string;
  readonly [field: string]: unknown;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  /** A logger that adds `fields` to every record (e.g. the job id). */
  child(fields: Record<string, unknown>): Logger;
}

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(
  sink: (record: LogRecord) => void,
  options: { level?: Level; fields?: Record<string, unknown>; now?: () => Date } = {},
): Logger {
  const min = ORDER[options.level ?? "info"];
  const base = options.fields ?? {};
  const now = options.now ?? (() => new Date());
  const log =
    (level: Level) =>
    (msg: string, fields: Record<string, unknown> = {}) => {
      if (ORDER[level] < min) return;
      sink({ ...base, ...fields, level, msg, at: now().toISOString() });
    };
  return {
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    child: (fields) => createLogger(sink, { ...options, fields: { ...base, ...fields } }),
  };
}

/** Drops everything: the default when the caller wants no logs. */
export const silentLogger: Logger = createLogger(() => {}, { level: "error" });

/** One JSON object per line, for a stream such as stderr. */
export function jsonLines(write: (line: string) => void): (record: LogRecord) => void {
  return (record) => write(`${JSON.stringify(record)}\n`);
}
