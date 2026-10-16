export class IngestError extends Error {
  constructor(
    readonly code: "TIMEOUT" | "PASSWORD" | "UNREADABLE" | "LIMIT" | "DOCLING",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "IngestError";
  }
}

/** Rejects after `ms` (security §5: 60 s per file by default). */
export async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new IngestError("TIMEOUT", `${what} took longer than ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
