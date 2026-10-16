import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { Config, JobEvent, MetricFile } from "../src/index.ts";

// The example from docs/specs/metric-layer.md §1, verbatim.
const METRIC_YAML = `
version: 1
grain: month
timezone: Asia/Tashkent
objective: "Grow monthly gross profit without losing wholesale clients"
entities:
  - id: customer
    source: t_sales.customer_name
metrics:
  - id: revenue
    label: Revenue
    type: sum
    table: t_sales
    expression: amount
    filters: ["status <> 'refunded'"]
    time_column: order_date
    unit: currency
    currency: UZS
    dimensions: [channel, customer, product]
    status: confirmed
  - id: refund_rate
    label: Refund rate
    type: ratio
    numerator: { table: t_sales, expression: amount, filters: ["status = 'refunded'"] }
    denominator: { metric: revenue }
    unit: percent
    status: assumed
`;

// The example from docs/specs/models.md §4.
const CONFIG_YAML = `
models:
  planner:   { provider: ollama, model: qwen3.5:9b }
  extractor: { provider: ollama, model: qwen3.5:9b }
  judge:     { provider: ollama, model: qwen3.5:9b }
  embedder:  { provider: transformers, model: Xenova/bge-m3 }
providers:
  ollama: { base_url: http://localhost:11434 }
  openai-compatible:
    groq: { base_url: https://api.groq.com/openai/v1, api_key_env: GROQ_API_KEY }
`;

describe("metric YAML", () => {
  it("parses the spec example", () => {
    const parsed = MetricFile.parse(parse(METRIC_YAML));
    expect(parsed.metrics.map((m) => m.id)).toEqual(["revenue", "refund_rate"]);
  });

  it("rejects a ratio without a denominator and a currency metric without a currency", () => {
    const doc = parse(METRIC_YAML) as { metrics: Record<string, unknown>[] };
    delete doc.metrics[1]?.denominator;
    delete doc.metrics[0]?.currency;
    const res = MetricFile.safeParse(doc);
    expect(res.success).toBe(false);
    const messages = res.success ? [] : res.error.issues.map((i) => i.message);
    expect(messages).toContain("ratio metrics need numerator and denominator");
    expect(messages).toContain("currency metrics need an ISO 4217 currency");
  });

  it("rejects a sum without a table", () => {
    const res = MetricFile.safeParse({
      version: 1,
      grain: "month",
      metrics: [{ id: "x", label: "X", type: "sum", expression: "a", unit: "count", status: "assumed" }],
    });
    expect(res.success).toBe(false);
  });
});

describe("config", () => {
  it("parses the spec example and fills defaults", () => {
    const c = Config.parse(parse(CONFIG_YAML));
    expect(c.models.planner).toEqual({ provider: "ollama", model: "qwen3.5:9b" });
    expect(c.timeouts.model_ms).toBe(120_000);
    expect(c.web.enabled).toBe(false);
  });

  it("requires an endpoint for openai-compatible roles and rejects unknown (paid) providers", () => {
    const base = parse(CONFIG_YAML) as { models: Record<string, unknown> };
    expect(Config.safeParse({ ...base, models: { ...base.models, planner: { provider: "openai-compatible", model: "m" } } }).success).toBe(
      false,
    );
    expect(Config.safeParse({ ...base, models: { ...base.models, planner: { provider: "anthropic", model: "m" } } }).success).toBe(false);
  });
});

describe("job events", () => {
  it("accepts each event type and rejects unknown stages", () => {
    const base = { job_id: "j1", seq: 1, at: "2026-07-01T09:00:00+05:00" };
    expect(JobEvent.parse({ ...base, type: "stage_started", stage: "INGEST" }).type).toBe("stage_started");
    expect(JobEvent.parse({ ...base, type: "failed", error: { code: "V2_MISMATCH", message: "x" } }).type).toBe("failed");
    expect(JobEvent.safeParse({ ...base, type: "stage_started", stage: "DREAM" }).success).toBe(false);
  });
});
