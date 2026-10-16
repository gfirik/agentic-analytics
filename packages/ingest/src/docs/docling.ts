// Optional docling-serve client for scanned or complex PDFs (spec §4). Docling runs in its own container
// with no network (security §5); this client only talks to the configured base URL.
import { IngestError } from "../errors.ts";

export interface DoclingClient {
  /** Markdown per page. */
  convertPdf(bytes: Uint8Array, name: string, signal?: AbortSignal): Promise<string[]>;
}

export const DOCLING_PAGE_BREAK = "<!-- aa-page-break -->";

export function createDoclingClient(baseUrl: string, f: typeof fetch = globalThis.fetch, timeoutMs = 120_000): DoclingClient {
  const url = `${baseUrl.replace(/\/+$/, "")}/v1/convert/file`;
  return {
    async convertPdf(bytes, name, signal) {
      const form = new FormData();
      form.append("files", new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }), name);
      form.append("to_formats", "md");
      form.append("do_ocr", "true");
      form.append("md_page_break_placeholder", DOCLING_PAGE_BREAK);
      let res: Response;
      try {
        res = await f(url, {
          method: "POST",
          body: form,
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new IngestError("DOCLING", `docling-serve is not reachable at ${baseUrl}`, { cause: err });
      }
      if (!res.ok) throw new IngestError("DOCLING", `docling-serve returned HTTP ${res.status}`);
      const body = (await res.json()) as { document?: { md_content?: string } };
      const md = body.document?.md_content;
      if (typeof md !== "string") throw new IngestError("DOCLING", "docling-serve returned no markdown");
      return md.split(DOCLING_PAGE_BREAK).map((p) => p.trim());
    },
  };
}
