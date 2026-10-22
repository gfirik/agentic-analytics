// Text of the coffee-roaster documents. The quotes cited by the golden report are substrings of these,
// so a test can check every citation quote and char span against the source text.
import { docx, emlText } from "./writers.ts";

export const PRICE_LIST_PAGES: readonly (readonly string[])[] = [
  [
    "Northside Coffee Roasters",
    "Price list 2026",
    "Retail (per bag)",
    "Espresso blend 250g ... 9.50",
    "Filter blend 250g ... 9.00",
    "Drip bags x10 ... 7.50",
  ],
  [
    "Wholesale terms",
    "Wholesale prices increase 12% from 15 March 2026.",
    "Espresso blend 1kg ... 24.60",
    "Filter blend 1kg ... 23.50",
    "Minimum order: 10 kg. Delivery twice a week.",
  ],
  ["Payment terms", "Invoices are due within 14 days.", "Late payments may pause standing orders."],
  ["Contact", "orders@roaster.example", "Northside Coffee Roasters, Tashkent"],
];

/** Page text as a text extractor returns it: lines joined with newlines (no blank lines: extractors drop them). */
export function pageText(page: number): string {
  return (PRICE_LIST_PAGES[page - 1] ?? []).join("\n");
}

export const EMAIL_BODY =
  "Hello,\n\nAfter the new price list we are pausing our standing order while we compare suppliers.\nWe will let you know about May.\n\nPurchasing team\nHotel Group\n";

export const EMAIL_EML = emlText(
  {
    from: '"Purchasing, Hotel Group" <purchasing@hotelgroup.example>',
    to: "orders@roaster.example",
    subject: "Standing order",
    date: "Sun, 12 Apr 2026 09:14:00 +0500",
    id: "0412@hotelgroup.example",
  },
  EMAIL_BODY,
);

/** ops-notes.docx: numbered sections; §3 carries the packaging-supplier switch (planted P2 cause). */
export const OPS_NOTES: readonly { heading: string; paragraphs: readonly string[] }[] = [
  { heading: "1. Roasting", paragraphs: ["Roast schedule moved to Monday and Thursday mornings."] },
  { heading: "2. Staff", paragraphs: ["One new barista started at the shop counter."] },
  {
    heading: "3. Packaging",
    paragraphs: ["Switched to the new packaging supplier on 28 April.", "The new valve bags are cheaper per unit."],
  },
  { heading: "4. Equipment", paragraphs: ["Grinder serviced; no downtime."] },
];

/** Plain text of the notes as a DOCX text extractor returns it: one paragraph per line. */
export function opsNotesText(): string {
  return OPS_NOTES.flatMap((s) => [s.heading, ...s.paragraphs]).join("\n");
}

export function opsNotesDocx(): Uint8Array {
  return docx(OPS_NOTES);
}
