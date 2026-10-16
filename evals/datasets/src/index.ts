export * from "./coffee-roaster.ts";
export { EMAIL_BODY, EMAIL_EML, OPS_NOTES, opsNotesDocx, opsNotesText, PRICE_LIST_PAGES, pageText } from "./documents.ts";
export { textPdf } from "./pdf.ts";
export { salesWorkbook, salesXlsx } from "./workbook.ts";
export { crc32, zipStored } from "./zip.ts";

import { EMAIL_EML, opsNotesDocx, PRICE_LIST_PAGES } from "./documents.ts";
import { textPdf } from "./pdf.ts";
import { salesXlsx } from "./workbook.ts";

/** Every file of coffee-roaster-v1, by file name. */
export function coffeeRoasterFiles(): Record<string, Uint8Array> {
  return {
    "sales-2026.xlsx": salesXlsx(),
    "price-list.pdf": textPdf(PRICE_LIST_PAGES),
    "email-0412.eml": new TextEncoder().encode(EMAIL_EML),
    "ops-notes.docx": opsNotesDocx(),
  };
}

import { createHash } from "node:crypto";
import { buildGoldenReport } from "./golden-report.ts";

export { buildGoldenReport } from "./golden-report.ts";

/** The golden report fixture as committed: pretty JSON with a trailing newline. */
export function goldenReportJson(): string {
  const fileHashes = Object.fromEntries(
    Object.entries(coffeeRoasterFiles()).map(([name, data]) => [name, createHash("sha256").update(data).digest("hex")]),
  );
  return `${JSON.stringify(buildGoldenReport({ fileHashes }), null, 2)}\n`;
}
