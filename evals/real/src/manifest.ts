// The public datasets of the real-data tier (evals/real/README.md, evals/real/DATASETS.md): where each is
// downloaded from, its licence and credit, the SHA-256 of every byte we read, and how the file the engine reads is
// derived. Nothing here is committed data: `bun run --filter @agentic-analytics/eval-real fetch` downloads it.
import { deriveCardSpendByIndustry, deriveHotelBookings, deriveOnlineRetailSample } from "./derive.ts";

export interface RealDataset {
  readonly id: string;
  readonly title: string;
  readonly publisher: string;
  /** The publisher's page, where the licence is stated. */
  readonly page: string;
  readonly licence: {
    readonly name: string;
    readonly url: string;
    readonly evidence: string;
    /**
     * Re-read before every download: the download stops (LICENCE_CHANGED) unless the page at `url` still contains
     * `text` (compared as plain text: tags, entities and runs of whitespace removed). A licence can change after we
     * read it, and the files are only ours to use under the terms stated now. Optional in the type so a test's toy
     * dataset needs no licence page; every public dataset sets it (a test checks).
     */
    readonly check?: { readonly url: string; readonly text: string };
  };
  readonly citation: string;
  readonly download: {
    readonly url: string;
    /** SHA-256 of the downloaded bytes (a ZIP archive, or the file itself when `raw`). */
    readonly sha256: string;
    readonly bytes: number;
    /**
     * The download is the file itself, not an archive (a Socrata CSV export): `derive` takes it as its one input,
     * and `entries` is empty.
     */
    readonly raw?: boolean;
    /** The entries read from the archive, in the order `derive` takes them, each with its SHA-256. */
    readonly entries: readonly { readonly name: string; readonly sha256: string }[];
  };
  /** The file the engine reads, derived deterministically from the entries. */
  readonly derived: {
    readonly file: string;
    readonly sha256: string;
    readonly how: string;
    readonly derive: (entries: readonly Uint8Array[]) => Uint8Array;
  };
}

const utf8 = new TextEncoder();
const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

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
      check: {
        url: "https://archive.ics.uci.edu/dataset/502/online+retail+ii",
        text: "This dataset is licensed under a Creative Commons Attribution 4.0 International (CC BY 4.0) license.",
      },
    },
    citation: "Chen, D. (2012). Online Retail II [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5CG6D.",
    download: {
      url: "https://archive.ics.uci.edu/static/public/502/online+retail+ii.zip",
      sha256: "572e36277c2390fbfde10664750731e0a86f55e33470d91919085f0408e67bfb",
      bytes: 45_622_418,
      entries: [{ name: "online_retail_II.xlsx", sha256: "bcbe73b35f5b7babf197fb0cb983a11f5d9ff929078d4aa53d171b1f2df2e980" }],
    },
    derived: {
      file: "online_retail_II.sample10.csv",
      sha256: "6d8dff8c0bff0e9a2b158b792b0bbc5940f4f81a597da3af3583f1ebaada7858",
      how: "Every invoice whose number is divisible by 10 (cancellations 'C…' included), both sheets, as CSV with ISO dates.",
      derive: ([xlsx]) => utf8.encode(deriveOnlineRetailSample(xlsx as Uint8Array, 10)),
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
      check: {
        url: "https://www.stats.govt.nz/about-us/copyright/",
        text: "Unless otherwise specified, content we produce is licensed under the Creative Commons Attribution 4.0 International licence.",
      },
    },
    citation:
      "This work is based on Stats NZ's data (Electronic card transactions: September 2026) which are licensed by Stats NZ for reuse under the Creative Commons Attribution 4.0 International licence.",
    download: {
      url: "https://www.stats.govt.nz/assets/Uploads/Electronic-card-transactions/Electronic-card-transactions-September-2026/Download-data/electronic-card-transactions-september-2026.zip",
      sha256: "a89b02ba61b127baf3894bb333961710e4b4d6486dfcdc012d18c0655aa970c2",
      bytes: 158_264,
      entries: [
        {
          name: "electronic-card-transactions-september-2026-csv-tables.csv",
          sha256: "60481c7f33519db445819b740e0468df72ee5c4bcb360ee213402b7a02adcee9",
        },
      ],
    },
    derived: {
      file: "nz-card-spend-by-industry.csv",
      sha256: "63ff45be4c783950ae58d263f021a6c5b5dcd424c0b8b84732d978199d42ed9f",
      how: "Rows of series ECTM.S1GA1–ECTM.S1GA8 (monthly, actual values by industry group), the file's lines unchanged.",
      derive: ([csv]) => utf8.encode(deriveCardSpendByIndustry(text(csv))),
    },
  },
  {
    id: "hotel-bookings",
    title: "Hotel booking demand datasets",
    publisher: "Data in Brief (Elsevier)",
    page: "https://doi.org/10.1016/j.dib.2018.11.126",
    licence: {
      name: "CC BY 4.0",
      url: "https://creativecommons.org/licenses/by/4.0/",
      evidence: "This is an open access article under the CC BY license (http://creativecommons.org/licenses/by/4.0/).",
      // ScienceDirect's article page answers 403 to scripts, so the licence is re-read from the article's full text in
      // Europe PMC (PMC6297060), the open archive the publisher deposits it in; the supplement is downloaded from
      // the publisher's own file host (ars.els-cdn.com), never a mirror.
      check: {
        url: "https://www.ebi.ac.uk/europepmc/webservices/rest/PMC6297060/fullTextXML",
        text: "This is an open access article under the CC BY license (http://creativecommons.org/licenses/by/4.0/).",
      },
    },
    citation:
      "Antonio, N., de Almeida, A., & Nunes, L. (2019). Hotel booking demand datasets. Data in Brief, 22, 41–49. https://doi.org/10.1016/j.dib.2018.11.126.",
    download: {
      url: "https://ars.els-cdn.com/content/image/1-s2.0-S2352340918315191-mmc2.zip",
      sha256: "6db57d635b9edec05f1cf9616ba6473e864909e4fc34819fa21cff58d518ee6a",
      bytes: 1_361_767,
      entries: [
        { name: "H1.csv", sha256: "6f38fda13794fd6cf6547d2432ffb79666200000eb45fd09e4b97fe49519a6ab" },
        { name: "H2.csv", sha256: "5107090ffdc5585a9e18299801e9d85c3b459c235542882183a502a73ef63c4d" },
      ],
    },
    derived: {
      file: "hotel-bookings.csv",
      sha256: "3b22c26428ec81ad9432ec81f063c3623921ea0865066b5412535a39d143773b",
      how: "H1.csv (resort hotel) then H2.csv (city hotel) in one CSV, each line unchanged behind two added fields: Hotel and ArrivalDate (ISO, from the arrival year, month and day).",
      derive: ([h1, h2]) => utf8.encode(deriveHotelBookings(text(h1), text(h2))),
    },
  },
  {
    id: "montgomery-warehouse-sales",
    title: "Warehouse and Retail Sales (Montgomery County, Maryland), 2017–2020",
    publisher: "Montgomery County, MD (Department of Liquor Control, on data.montgomerycountymd.gov)",
    page: "https://data.montgomerycountymd.gov/d/v76h-r7br",
    licence: {
      name: "Public domain",
      url: "https://data.montgomerycountymd.gov/api/views/v76h-r7br.json",
      evidence: '"license" : { "name" : "Public Domain" }',
      // Socrata states the licence in the dataset's metadata (the human page is rendered by script). The wording is
      // compared as plain text, so the metadata's pretty-printing doesn't matter.
      check: {
        url: "https://data.montgomerycountymd.gov/api/views/v76h-r7br.json",
        text: '"license" : { "name" : "Public Domain" }',
      },
    },
    citation: "Source: Montgomery County, MD. Warehouse and Retail Sales, data.montgomerycountymd.gov/d/v76h-r7br (Public Domain).",
    download: {
      // The dataset grows every month (2026 months were appended after a gap since 2020), so a whole-file checksum would
      // break on each update. The query pins the closed years 2017–2020 in a total order, which makes the bytes fixed.
      url: "https://data.montgomerycountymd.gov/resource/v76h-r7br.csv?$where=calendar_year%3C%3D2020&$order=calendar_year%2Ccal_month_num%2Csupplier%2Citem_code%2Citem_description%2Citem_type%2Crtl_sales%2Crtl_transfers%2Cwhs_sales&$limit=1000000",
      sha256: "b1f5450e132cb4981f27f213da943815e4d6157d036a4ca75669c7e634288851",
      bytes: 30_773_087,
      raw: true,
      entries: [],
    },
    derived: {
      file: "montgomery-warehouse-sales.csv",
      sha256: "b1f5450e132cb4981f27f213da943815e4d6157d036a4ca75669c7e634288851",
      how: "The Socrata CSV export of calendar years 2017–2020 (307,645 rows), unchanged, ordered by every column so the bytes are fixed.",
      derive: ([csv]) => csv as Uint8Array,
    },
  },
];

/**
 * A dataset chosen for the tier whose files this machine could not download yet, so nothing about them is pinned:
 * no checksum, no derivation, no answer numbers. `bun run eval:real:fetch` re-checks its licence and probes its page
 * on every run and says whether it is reachable; the run that reaches it pins the dated file and moves the dataset
 * into REAL_DATASETS (evals/real/DATASETS.md, "Pending").
 */
export interface PendingDataset {
  readonly id: string;
  readonly title: string;
  readonly publisher: string;
  /** The publisher's data page, where the files are listed. */
  readonly page: string;
  readonly licence: RealDataset["licence"] & { readonly check: { readonly url: string; readonly text: string } };
  readonly citation: string;
  /** Why it is pending, and what pinning it involves. */
  readonly deferred: string;
}

export const PENDING_DATASETS: readonly PendingDataset[] = [
  {
    id: "eia-861m",
    title: "Monthly electric power industry report (EIA-861M): sales to ultimate customers",
    publisher: "U.S. Energy Information Administration",
    page: "https://www.eia.gov/electricity/data/eia861m/",
    licence: {
      name: "Public domain (U.S. government work)",
      url: "https://www.eia.gov/about/copyrights_reuse.php",
      evidence: "U.S. government publications are in the public domain and are not subject to copyright protection.",
      check: {
        url: "https://www.eia.gov/about/copyrights_reuse.php",
        text: "U.S. government publications are in the public domain and are not subject to copyright protection.",
      },
    },
    citation: "Source: U.S. Energy Information Administration, Form EIA-861M (formerly EIA-826), Monthly Electric Power Industry Report.",
    deferred:
      "www.eia.gov does not answer from this machine (TCP connect timeout, 2026-10-22). EIA revises preliminary months, so the run that reaches it pins a dated file whose months are final (the page's archive), writes the derivation against the layout it sees (multi-row Excel headers) and fills the pending answer file from SQL on it.",
  },
];
