// Public API of @agentic-analytics/eval-real: the real-data eval tier (evals/real/README.md).

export { parseRealAnswers, RealAnswers, type RealCheck } from "./answers.ts";
export { deriveCardSpendByIndustry, deriveOnlineRetailSample, keepInvoice, serialToIso } from "./derive.ts";
export { type FetchDeps, type Fetched, fetchDataset, RealDataError, sha256, verifySha256, zipEntry } from "./fetch.ts";
export { REAL_DATASETS, type RealDataset } from "./manifest.ts";
