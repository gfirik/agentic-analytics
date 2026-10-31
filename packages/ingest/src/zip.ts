// ZIP structure for xlsx/docx: the central directory (to classify the file) and the true decompressed size
// (to stop decompression bombs before SheetJS or mammoth sees the bytes), docs/specs/security.md §5.
//
// Every size field in a ZIP is written by whoever made the file, so none of them is trusted for the limit.
// SheetJS inflates each entry from its local header to the end of the deflate stream, ignoring the sizes;
// JSZip (inside mammoth) inflates in full before it compares sizes. measureZip therefore inflates every
// entry itself, counting and discarding the output, and stops as soon as the running total passes the cap.
// The checks on the directory are strict on purpose: the parsers must read exactly the entries we measured.

export interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
  /** Carries a ZIP64 extended-information extra field (id 0x0001). */
  readonly zip64: boolean;
}

interface ZipDirectory {
  readonly entries: ZipEntry[];
  readonly centralOffset: number;
}

export class ZipError extends Error {
  constructor(
    readonly code: "MALFORMED" | "TOO_LARGE",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ZipError";
  }
}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const MAX16 = 0xffff;
const MAX32 = 0xffffffff;
const STORED = 0;
const DEFLATED = 8;

const malformed = (why: string, cause?: unknown) =>
  new ZipError("MALFORMED", `damaged or unsupported ZIP structure: ${why}`, cause === undefined ? undefined : { cause });

/** The central directory, or undefined when it is missing or malformed (used to classify the file). */
export function readZipEntries(bytes: Uint8Array): ZipEntry[] | undefined {
  try {
    return readZipDirectory(bytes).entries;
  } catch (err) {
    if (err instanceof ZipError) return undefined;
    throw err;
  }
}

function readZipDirectory(bytes: Uint8Array): ZipDirectory {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The last end-of-central-directory signature in the file: the one SheetJS and JSZip both pick.
  let eocd = -1;
  for (let i = bytes.length - 4; i >= 0; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw malformed("no end of central directory");
  if (eocd + 22 > bytes.length) throw malformed("truncated end of central directory");
  const disk = view.getUint16(eocd + 4, true);
  const centralDisk = view.getUint16(eocd + 6, true);
  // SheetJS counts the entries on this disk, JSZip the total: they must agree.
  const diskEntries = view.getUint16(eocd + 8, true);
  const count = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (count === MAX16 || centralSize === MAX32 || centralOffset === MAX32) throw malformed("ZIP64 archives are not supported");
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== count) throw malformed("multi-disk or inconsistent entry counts");
  // JSZip shifts every offset when the directory is not where the EOCD says; require it to be exactly there.
  if (centralOffset + centralSize !== eocd) throw malformed("central directory is not where the end record says");

  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder();
  let p = centralOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > eocd || view.getUint32(p, true) !== SIG_CENTRAL) throw malformed("bad central directory entry");
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const end = p + 46 + nameLen + extraLen + commentLen;
    if (end > eocd) throw malformed("central directory entry runs past the directory");
    entries.push({
      name: decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen)),
      method: view.getUint16(p + 10, true),
      compressedSize: view.getUint32(p + 20, true),
      uncompressedSize: view.getUint32(p + 24, true),
      localOffset: view.getUint32(p + 42, true),
      zip64: hasZip64Field(view, p + 46 + nameLen, extraLen),
    });
    p = end;
  }
  // JSZip reads central headers until the signature changes, whatever the count says: nothing may follow.
  if (p !== eocd) throw malformed("central directory holds more than the counted entries");
  return { entries, centralOffset };
}

function hasZip64Field(view: DataView, start: number, length: number): boolean {
  for (let q = start; q + 4 <= start + length; q += 4 + view.getUint16(q + 2, true)) {
    if (view.getUint16(q, true) === 0x0001) return true;
  }
  return false;
}

/**
 * The true decompressed size of a ZIP's entries, measured by inflating each one with the output counted
 * and thrown away. Throws ZipError TOO_LARGE as soon as the total passes `cap`, and MALFORMED for any
 * structure the parsers could read differently from us (security §5).
 *
 * Each entry is inflated only up to the next entry's local header (or the central directory), so the
 * total input inflated is at most the file's own size, even with overlapping or lying entries. A deflate
 * stream that does not end inside that window is rejected: a parser could run it on into the next entry.
 */
export async function measureZip(bytes: Uint8Array, cap: number): Promise<number> {
  const { entries, centralOffset } = readZipDirectory(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sorted = [...entries].sort((a, b) => a.localOffset - b.localOffset);
  let total = 0;
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i] as ZipEntry;
    const windowEnd = sorted[i + 1]?.localOffset ?? centralOffset;
    if (e.localOffset >= windowEnd) throw malformed("entries share or overlap their data");
    if (e.localOffset + 30 > windowEnd || view.getUint32(e.localOffset, true) !== SIG_LOCAL) throw malformed("bad local header");
    // SheetJS takes the method and stored size from the local header, JSZip from the central one.
    const method = view.getUint16(e.localOffset + 8, true);
    const localSize = view.getUint32(e.localOffset + 18, true);
    const nameLen = view.getUint16(e.localOffset + 26, true);
    const extraLen = view.getUint16(e.localOffset + 28, true);
    const dataStart = e.localOffset + 30 + nameLen + extraLen;
    if (dataStart > windowEnd) throw malformed("local header runs past its entry");
    if (method !== e.method) throw malformed("local and central headers disagree on the compression method");
    if (method === STORED) {
      // ZIP64 fields would let SheetJS take a different stored size than the one checked here.
      if (e.zip64 || hasZip64Field(view, e.localOffset + 30 + nameLen, extraLen)) throw malformed("ZIP64 stored entry");
      const size = Math.max(localSize, e.compressedSize);
      if (dataStart + size > windowEnd) throw malformed("entry data runs past its entry");
      total += size;
    } else if (method === DEFLATED) {
      total += await inflatedSize(bytes.subarray(dataStart, windowEnd), cap - total);
    } else {
      throw malformed(`compression method ${method}`);
    }
    if (total > cap) throw tooLarge(cap);
  }
  return total;
}

const tooLarge = (cap: number) => new ZipError("TOO_LARGE", `decompresses to more than the ${cap}-byte limit; possible ZIP bomb`);

/**
 * Inflates raw deflate data, counting the output without keeping it, and stops as soon as the count
 * passes `budget`. A stream that is corrupt or does not end inside `data` is MALFORMED. Bytes after the
 * stream's end (a data descriptor) are ignored, as Node's zlib does; a runtime that rejects them instead
 * fails closed, and the data-descriptor test in packages/ingest/test catches it.
 */
async function inflatedSize(data: Uint8Array, budget: number): Promise<number> {
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  // Compression streams take ArrayBuffer-backed views only; a view on shared memory is copied.
  const chunk = data.buffer instanceof ArrayBuffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
  // The write side fails whenever the read side cancels or errors; the read side reports why.
  const feeding = writer
    .write(chunk)
    .then(() => writer.close())
    .catch(() => undefined);
  let count = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > budget) {
        // Over the limit: the caller rejects the file, so the rest of the stream is never inflated.
        await reader.cancel();
        break;
      }
    }
  } catch (err) {
    throw malformed("a compressed entry is corrupt or does not end inside its entry", err);
  } finally {
    await feeding;
  }
  return count;
}
