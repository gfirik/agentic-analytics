// Job workspace schema (docs/ARCHITECTURE.md §3). Migrations are append-only: never edit a shipped one,
// add a new version. Per-table data lives in `t_<id>` tables created by `loadJob`.

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly statements: readonly string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "workspace v1",
    statements: [
      `CREATE TABLE files (
        id VARCHAR PRIMARY KEY, name VARCHAR NOT NULL, sha256 VARCHAR NOT NULL, mime VARCHAR, kind VARCHAR,
        size BIGINT, status VARCHAR NOT NULL, duplicate_of VARCHAR, parent VARCHAR)`,
      `CREATE TABLE sources (
        id VARCHAR PRIMARY KEY, file_id VARCHAR NOT NULL, kind VARCHAR NOT NULL, external BOOLEAN NOT NULL DEFAULT false,
        table_id VARCHAR, sheet VARCHAR, range_a1 VARCHAR, hidden_sheet BOOLEAN, header_rows INTEGER[], notes VARCHAR[], transposed BOOLEAN,
        page INTEGER, section VARCHAR[], char_start INTEGER, char_end INTEGER, text VARCHAR)`,
      `CREATE TABLE table_columns (
        table_id VARCHAR NOT NULL, position INTEGER NOT NULL, name VARCHAR NOT NULL, label VARCHAR NOT NULL, letter VARCHAR,
        type VARCHAR NOT NULL, currency VARCHAR, PRIMARY KEY (table_id, name))`,
      `CREATE TABLE profile_columns (
        table_id VARCHAR NOT NULL, name VARCHAR NOT NULL, type VARCHAR NOT NULL, non_null BIGINT, null_pct DOUBLE, distinct_count BIGINT,
        min_value VARCHAR, max_value VARCHAR, top_values JSON, median DOUBLE, mad DOUBLE, outlier_rows INTEGER[], PRIMARY KEY (table_id, name))`,
      `CREATE TABLE profile_tables (
        table_id VARCHAR PRIMARY KEY, row_count BIGINT, detail_rows BIGINT, total_rows BIGINT, duplicate_rows BIGINT,
        key_columns VARCHAR[], key_duplicates BIGINT, date_column VARCHAR, date_first DATE, date_last DATE, grain VARCHAR,
        missing_periods VARCHAR[])`,
      `CREATE TABLE quality_issues (
        id VARCHAR PRIMARY KEY, kind VARCHAR NOT NULL, severity VARCHAR NOT NULL, message VARCHAR NOT NULL,
        file_id VARCHAR, source_id VARCHAR, sheet VARCHAR, cell VARCHAR, rows INTEGER[], page INTEGER, column_name VARCHAR, details JSON)`,
      `CREATE TABLE entities (id VARCHAR PRIMARY KEY, kind VARCHAR NOT NULL, canonical_name VARCHAR NOT NULL)`,
      `CREATE TABLE entity_links (
        entity_id VARCHAR NOT NULL, source_id VARCHAR NOT NULL, column_name VARCHAR NOT NULL, raw_value VARCHAR NOT NULL,
        normalized VARCHAR NOT NULL, confidence DOUBLE NOT NULL, row_count BIGINT NOT NULL)`,
      `CREATE TABLE metric_defs (id VARCHAR PRIMARY KEY, yaml VARCHAR NOT NULL, sql VARCHAR NOT NULL, status VARCHAR NOT NULL)`,
      `CREATE TABLE facts (
        id VARCHAR PRIMARY KEY, label VARCHAR NOT NULL, value DOUBLE NOT NULL, unit VARCHAR NOT NULL, currency VARCHAR, metric_id VARCHAR,
        kind VARCHAR NOT NULL, sql VARCHAR, params JSON, fn VARCHAR, inputs VARCHAR[], input_rows JSON, definition_id VARCHAR)`,
      `CREATE TABLE insights (id VARCHAR PRIMARY KEY, template VARCHAR NOT NULL, metric_id VARCHAR, period VARCHAR, payload JSON, fact_ids VARCHAR[])`,
      `CREATE TABLE decompositions (id VARCHAR PRIMARY KEY, method VARCHAR NOT NULL, insight_id VARCHAR, payload JSON, fact_ids VARCHAR[])`,
      `CREATE TABLE chunks (
        id VARCHAR PRIMARY KEY, source_id VARCHAR NOT NULL, page INTEGER, char_start INTEGER, char_end INTEGER, heading_path VARCHAR[],
        prefix VARCHAR, text VARCHAR NOT NULL, embedding FLOAT[])`,
      `CREATE TABLE extracts (id VARCHAR PRIMARY KEY, source_id VARCHAR NOT NULL, chunk_id VARCHAR, payload JSON, suspicious BOOLEAN NOT NULL DEFAULT false)`,
      `CREATE TABLE web_results (
        id VARCHAR PRIMARY KEY, url VARCHAR NOT NULL, title VARCHAR, fetched_at TIMESTAMP, extract_ids VARCHAR[], external BOOLEAN NOT NULL DEFAULT true)`,
      `CREATE TABLE claims (id VARCHAR PRIMARY KEY, text VARCHAR NOT NULL, fact_ids VARCHAR[], citations JSON, causal_grade VARCHAR, verified BOOLEAN)`,
      `CREATE TABLE verification (id VARCHAR PRIMARY KEY, claim_id VARCHAR, fact_id VARCHAR, check_name VARCHAR NOT NULL, passed BOOLEAN NOT NULL, detail VARCHAR)`,
      `CREATE TABLE events (seq BIGINT PRIMARY KEY, job_id VARCHAR NOT NULL, occurred_at TIMESTAMP NOT NULL, type VARCHAR NOT NULL, payload JSON)`,
    ],
  },
  {
    version: 2,
    name: "metric_defs.params",
    statements: ["ALTER TABLE metric_defs ADD COLUMN params JSON"],
  },
  {
    version: 3,
    name: "sources.meta, retrieval_meta",
    // Email headers (from, to, date, subject) for document sections: the retrieval chunk prefix needs them
    // (retrieval spec §1), and they are untrusted text like the body. retrieval_meta records which embedder and
    // stemmer built the chunk index, so a query is never embedded by a different model.
    statements: [
      "ALTER TABLE sources ADD COLUMN meta JSON",
      "CREATE TABLE retrieval_meta (embedder VARCHAR NOT NULL, dims INTEGER NOT NULL, stemmer VARCHAR NOT NULL, fts BOOLEAN NOT NULL, chunks INTEGER NOT NULL)",
    ],
  },
  {
    version: 4,
    name: "job_stages, job_meta",
    // Pipeline checkpoints (ARCHITECTURE §2): a crashed job resumes after its last completed stage. `output` keeps
    // a stage's small results (e.g. the EXPLAIN drafts); `first_fact` is where the stage's new facts start, so a
    // stage that is re-run first removes what its interrupted run left behind.
    statements: [
      `CREATE TABLE job_stages (stage VARCHAR PRIMARY KEY, status VARCHAR NOT NULL, started_at TIMESTAMP, completed_at TIMESTAMP,
        first_fact INTEGER, output JSON)`,
      "CREATE TABLE job_meta (key VARCHAR PRIMARY KEY, value JSON NOT NULL)",
    ],
  },
  {
    version: 5,
    name: "quarantine",
    // Sources quarantined for text that addresses a model (security §3), by the deterministic screen at INDEX_DOCS
    // or by the extractor's own flag. Their text never reaches the extractor again and they appear in data quality.
    statements: ["CREATE TABLE quarantine (source_id VARCHAR PRIMARY KEY, reason VARCHAR NOT NULL, detected_by VARCHAR NOT NULL)"],
  },
  {
    version: 6,
    name: "profile roles",
    // The role detector's proposals and candidates, and the table kinds PR 5 fills (docs/specs/semantics.md §2.5).
    statements: [
      `CREATE TABLE profile_roles (
        table_id VARCHAR NOT NULL, column_name VARCHAR NOT NULL, role VARCHAR NOT NULL, score DOUBLE NOT NULL,
        status VARCHAR NOT NULL, source VARCHAR NOT NULL, evidence_json JSON, PRIMARY KEY (table_id, column_name))`,
      `CREATE TABLE profile_role_candidates (
        table_id VARCHAR NOT NULL, column_name VARCHAR NOT NULL, role VARCHAR NOT NULL, score DOUBLE NOT NULL,
        PRIMARY KEY (table_id, column_name, role))`,
      "CREATE TABLE profile_table_kinds (table_id VARCHAR PRIMARY KEY, kind VARCHAR NOT NULL, evidence_json JSON)",
    ],
  },
  {
    version: 7,
    name: "period parts",
    // The year (and month) columns that together are the period of a table with no date column (semantics §2.1), read by
    // the concentration analysis (analysis-library §11).
    statements: ["CREATE TABLE profile_period_parts (table_id VARCHAR PRIMARY KEY, year_column VARCHAR NOT NULL, month_column VARCHAR)"],
  },
];
