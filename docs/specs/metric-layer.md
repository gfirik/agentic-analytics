# Spec: metric layer

Why it exists: the most common failure of AI analysts is computing the wrong quantity correctly (Argo-Bench, 2026). Semantic and metric layers measurably fix this. dbt reported 98–100% accuracy for semantic-layer queries vs 84–90% for text-to-SQL. The verifier can only check numbers against a definition, so the definition has to exist and be confirmed.

## 1. Format (YAML, compatible with Apache Ossie's metric concepts)

```yaml
version: 1
grain: month
timezone: Asia/Tashkent
objective: "Grow monthly gross profit without losing wholesale clients"   # optional, asked up front
entities:
  - id: customer
    source: t_sales.customer_name        # linked via entity matching
metrics:
  - id: revenue
    label: Revenue
    type: sum                            # sum | count | count_distinct | avg | ratio | derived
    table: t_sales
    expression: amount
    filters: ["status <> 'refunded'"]
    time_column: order_date
    unit: currency
    currency: UZS
    dimensions: [channel, customer, product]
    status: confirmed                    # confirmed | assumed
  - id: refund_rate
    label: Refund rate
    type: ratio
    numerator: { table: t_sales, expression: amount, filters: ["status = 'refunded'"] }
    denominator: { metric: revenue }
    unit: percent
    status: assumed
```

## 2. Drafting

1. Build a compact profile digest: table names, columns, types and sample values. Use at most 5 sample values per column. Any value that looks like a person's name or contact detail is masked.
2. The extractor-tier model proposes metric YAML, guided by a library of common business metrics: revenue, orders, average order value, units, gross margin, refunds/returns rate, customer count, new vs returning, wholesale vs retail share, cost lines, inventory days.
3. **Code validates every proposal**:
   - tables and columns exist;
   - types fit the aggregation;
   - filters parse;
   - dimensions exist;
   - ratios don't divide by a sum that could be zero without a guard;
   - a ratio doesn't divide a quantity by itself: the same metric on both sides, the same table + expression + filters, or a table term equal to the metric on the other side (a plain sum over its table's date column). It is always 1, so it is rejected: `ratio "x" divides "revenue" by itself (always 1)`. A derived metric whose expression is a top-level division of two identical expressions (`revenue / revenue`) is rejected the same way. Found on construction_supplier-v1 with a real model (M13h).
   Invalid proposals are dropped with a reason. The model is never trusted to be right.
4. **Grouping dimensions.** Code adds every grouping column of the table to a drafted sum, count or average: categories with 2 to 2,000 values, except a refund or return status column. Models often list too few, and a metric without the customer dimension can't name the client behind a drop (M13a). The analysis keeps the top 50 members plus "(other)". The prompt also asks for transaction tables over per-period summary sheets.
5. Deterministic fallbacks apply when the model is unavailable (or nothing it proposes is valid): columns named like `amount|revenue|sum|выручка|сумма|tushum` with a currency type become `revenue` candidates. A table with no such column but a price-named currency column and a quantity-named number column (invoice lines) gets `revenue = sum(quantity * price)`, so cancellation lines with negative quantities net out.

6. **Saved per job.** A job writes `metrics.drafted.json` to its folder right after drafting, before anything else can fail: the drafts as proposed (the model's, or the fallback's), the accepted definitions, the rejected ones with their reasons, the assumptions, the source and, when the fallback replaced an all-invalid model draft, that model draft with its reasons. A model's draft can't be re-created, so a later failure is traced from this file. `aa eval --keep-reports` keeps it next to each report. It is a debug artifact with no stable schema: its fields may change between versions, and nothing reads it back.

## 3. Confirmation

- **CLI:** an interactive review that shows each metric in plain words ("Revenue = sum of `amount` where status is not refunded, per month, in UZS") with accept / edit / drop options. `--yes` accepts everything as `assumed`.
- **API:** `GET /v1/jobs/{id}/metrics` returns the draft. `POST /v1/jobs/{id}/metrics` with YAML confirms it, and the job then continues.
- **MCP:** a `confirm_metrics` tool takes the YAML. If the job was started with `auto_confirm=true`, every definition is `assumed`.
- **Recording:** each assumed definition becomes an `Assumption` in the report and is attached to every finding using it.
- **Reuse:** confirmed definitions can be saved to `./agentic-analytics.metrics.yaml` and reused on the next run (P2: per-client memory).

## 4. Compilation

Each metric compiles to a parameterized SQL template: `metric(id, period_range, dimension_filters?, group_by?)`. All facts are produced through this compiler, so every number is tied to a `metric_id` and its SQL. Unit tests check the compiled SQL for every metric type against hand-computed answers. A ratio or derived metric joins its inputs' CTEs on period (and groups); each join side has its own alias (`m1 AS j0 FULL JOIN m2 AS j1`), so the SQL stays valid when the same CTE appears on both sides.

## 5. Objective

The user is asked once for the business goal. A default is used if they skip it: "grow profit while protecting key customers". The objective is stored in `report.objective` and used by DECIDE to rank recommendations. Argo-Bench showed that stating the objective lifts decision quality a lot.
