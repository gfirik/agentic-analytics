// Public API of @agentic-analytics/eval-real: the real-data eval tier (evals/real/README.md).

export { parseRealAnswers, RealAnswers, type RealCheck } from "./answers.ts";
export {
  deriveCardSpendByIndustry,
  deriveHotelBookings,
  deriveOnlineRetailSample,
  HOTEL_COLUMNS,
  keepInvoice,
  serialToIso,
} from "./derive.ts";
export {
  checkLicence,
  type FetchDeps,
  type Fetched,
  fetchDataset,
  plainText,
  probePending,
  RealDataError,
  sha256,
  verifySha256,
  zipEntry,
} from "./fetch.ts";
export { PENDING_DATASETS, type PendingDataset, REAL_DATASETS, type RealDataset } from "./manifest.ts";
