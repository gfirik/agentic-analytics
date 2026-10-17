// The public datasets of the real-data tier (evals/real/README.md, evals/real/DATASETS.md): where each is
// downloaded from, its licence and credit, the SHA-256 of every byte we read, and how the file the engine reads is
// derived. Nothing here is committed data: `bun run --filter @agentic-analytics/eval-real fetch` downloads it.
import { deriveCardSpendByIndustry, deriveOnlineRetailSample } from "./derive.ts";

export interface RealDataset {
  readonly id: string;
  readonly title: string;
  readonly publisher: string;
  /** The publisher's page, where the licence is stated. */
  readonly page: string;
  readonly licence: { readonly name: string; readonly url: string; readonly evidence: string };
  readonly citation: string;
  readonly download: {
    readonly url: string;
    /** SHA-256 of the downloaded bytes (a ZIP archive). */
    readonly sha256: string;
    readonly bytes: number;
    /** The entry read from the archive, and its SHA-256. */
    readonly entry: string;
    readonly entrySha256: string;
  };
  /** The file the engine reads, derived deterministically from the entry. */
  readonly derived: {
    readonly file: string;
    readonly sha256: string;
    readonly how: string;
    readonly derive: (entry: Uint8Array) => Uint8Array;
  };
}

const utf8 = new TextEncoder();

export const REAL_DATASETS: readonly RealDataset[] = [
  {
    id: "online-retail-ii",
    title: "Online Retail II",
    publisher: "UCI Machine Learning Repository",
    page: "https://archive.ics.uci.edu/dataset/502/online+retail+ii",
    licence: {
      name: "CC BY 4.0",
      url: "https://creativecommons.org/licenses/by/4.0/",
      evidence: "This dataset is licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) license.",
    },
    citation: "Chen, D. (2012). Online Retail II [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5CG6D.",
    download: {
      url: "https://archive.ics.uci.edu/static/public/502/online+retail+ii.zip",
      sha256: "572e36277c2390fbfde10664750731e0a86f55e33470d91919085f0408e67bfb",
      bytes: 45_622_418,
      entry: "online_retail_II.xlsx",
      entrySha256: "bcbe73b35f5b7babf197fb0cb983a11f5d9ff929078d4aa53d171b1f2df2e980",
    },
    derived: {
      file: "online_retail_II.sample10.csv",
      sha256: "6d8dff8c0bff0e9a2b158b792b0bbc5940f4f81a597da3af3583f1ebaada7858",
      how: "Every invoice whose number is divisible by 10 (cancellations 'C…' included), both sheets, as CSV with ISO dates.",
      derive: (entry) => utf8.encode(deriveOnlineRetailSample(entry, 10)),
    },
  },
  {
    id: "nz-card-spend",
    title: "Electronic card transactions, September 2026",
    publisher: "Stats NZ (Tatauranga Aotearoa)",
    page: "https://www.stats.govt.nz/information-releases/electronic-card-transactions-september-2026/",
    licence: {
      name: "CC BY 4.0",
      url: "https://creativecommons.org/licenses/by/4.0/",
      evidence:
        "Unless otherwise specified, content we produce is licensed under the Creative Commons Attribution 4.0 International licence. (https://www.stats.govt.nz/about-us/copyright/)",
    },
    citation:
      "This work is based on Stats NZ's data (Electronic card transactions: September 2026) which are licensed by Stats NZ for reuse under the Creative Commons Attribution 4.0 International licence.",
    download: {
      url: "https://www.stats.govt.nz/assets/Uploads/Electronic-card-transactions/Electronic-card-transactions-September-2026/Download-data/electronic-card-transactions-september-2026.zip",
      sha256: "a89b02ba61b127baf3894bb333961710e4b4d6486dfcdc012d18c0655aa970c2",
      bytes: 158_264,
      entry: "electronic-card-transactions-september-2026-csv-tables.csv",
      entrySha256: "60481c7f33519db445819b740e0468df72ee5c4bcb360ee213402b7a02adcee9",
    },
    derived: {
      file: "nz-card-spend-by-industry.csv",
      sha256: "63ff45be4c783950ae58d263f021a6c5b5dcd424c0b8b84732d978199d42ed9f",
      how: "Rows of series ECTM.S1GA1–ECTM.S1GA8 (monthly, actual values by industry group), the file's lines unchanged.",
      derive: (entry) => utf8.encode(deriveCardSpendByIndustry(new TextDecoder().decode(entry))),
    },
  },
];
