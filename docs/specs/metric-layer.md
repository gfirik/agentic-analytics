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
    cohort: new                          # optional, count_distinct only: count values whose first line falls in the period (new) or before it (returning)
    status: confirmed                    # confirmed | assumed
  - id: refund_rate
    label: Refund rate
    type: ratio
    numerator: { table: t_sales, expression: amount, filters: ["status = 'refunded'"] }
    denominator: { metric: revenue }
    unit: percent
    status: assumed
roles:                                   # additive (M15): confirmed or assumed column roles, docs/specs/semantics.md
  - { table: t_sales, column: unit_cost, role: unit_cost, status: confirmed }
  - { table: t_sales, column: std_cost, role: none, status: confirmed }    # dropped by the user
business_model: { model: wholesale, status: assumed }                     # semantics §4
```

`roles` and `business_model` are optional. A file without them (every file before M15) still loads, and the detector's proposals are then used as assumptions.

## 2. Drafting

0. **Code drafts the KPI pack first** (M15). From the confirmed or assumed roles and table kinds (semantics §1–§3), code drafts the sales KPI pack and margin (analysis-library §8.1, §9): `revenue`, `orders`, `units`, `aov`, `customers`, `new_customers`, `returning_customers`, `refund_rate`, `cancellation_rate`, `discount_rate`, `cost`, `gross_margin` and `gross_margin_pct`. Each is drafted only when its roles exist. These drafts don't depend on a model, so a small model can't miss them, and they go through the same validation (step 3). As built (M15 PR 7): `salesKpiPack` (packages/metrics/src/kpi-pack.ts), and `mergeMetricSets` (merge.ts) merges the sets in this order of precedence: the code's pack (a set the user confirmed replaces the whole list, so it is not merged), the model's validated draft, and only when no model draft is used the fallback's channel slices (`<member>_revenue`). Duplicates by definition are merged into the earlier one; an id reused with a different definition is rejected, `metrics.drafted.json` lists both; the pack's `notDrafted` list (KPI and reason) is in the draft result for PR 10. A role change re-drafts the pack and merges it with the model's proposals again (`redraftMetrics`).
1. Build a compact profile digest: table names, columns, types and sample values. Use at most 5 sample values per column. Any value that looks like a person's name or contact detail is masked.
2. The extractor-tier model proposes metric YAML, **added after the code's drafts** (from M15 it may add business-specific metrics next to the pack, and its drafts are deduped against the pack by definition: the same type, table, expression and filters, analysis-library §8.1; a duplicate keeps the code's id unless the user confirmed another). The digest lists each column's role. The model is guided by a library of common business metrics: revenue, orders, average order value, units, gross margin, refunds/returns rate, customer count, new vs returning, wholesale vs retail share, cost lines, inventory days.
3. **Code validates every proposal**:
   - tables and columns exist;
   - types fit the aggregation;
   - filters parse;
   - dimensions exist;
   - ratios don't divide by a sum that could be zero without a guard;
   - a ratio doesn't divide a quantity by itself: the same metric on both sides, the same table + expression + filters, or a table term equal to the metric on the other side (a plain sum over its table's date column). It is always 1, so it is rejected: `ratio "x" divides "revenue" by itself (always 1)`. A derived metric whose expression is a top-level division of two identical expressions (`revenue / revenue`) is rejected the same way. Found on construction_supplier-v1 with a real model (M13h).
   Invalid proposals are dropped with a reason. The model is never trusted to be right.
4. **Grouping dimensions.** Code adds every grouping column of the table to a drafted sum, count or average: categories with 2 to 2,000 values, except a refund or return status column. Models often list too few, and a metric without the customer dimension can't name the client behind a drop (M13a). The analysis keeps the top 50 members plus "(other)". The prompt also asks for transaction tables over per-period summary sheets.
5. Deterministic fallbacks apply when the model is unavailable (or nothing it proposes is valid): columns named like `amount|revenue|sum|выручка|сумма|tushum` with a currency type become `revenue` candidates. A table with no such column but a price-named currency column and a quantity-named number column (invoice lines) gets `revenue = sum(quantity * price)`, so cancellation lines with negative quantities net out. From M15 (PR 5) these name guesses read roles instead (`amount`; `quantity` and `unit_price`), and the code-drafted pack (step 0) makes most of them redundant.

6. **Saved per job.** A job writes `metrics.drafted.json` to its folder right after drafting, before anything else can fail: the drafts as proposed (the model's, or the fallback's), the accepted definitions, the rejected ones with their reasons, the assumptions, the source and, when the fallback replaced an all-invalid model draft, that model draft with its reasons. A model's draft can't be re-created, so a later failure is traced from this file. `aa eval --keep-reports` keeps it next to each report. It is a debug artifact with no stable schema: its fields may change between versions, and nothing reads it back.

## 3. Confirmation

Metrics and column roles are confirmed **on one screen** (analyst-grade §6.2; semantics §5). The roles come first, because a changed role changes which metrics code drafts.

- **CLI:** an interactive review that shows the columns that have a role, one line each with its evidence, plus each table's kind and the business model. Below them it shows each metric in plain words ("Revenue = sum of `amount` where status is not refunded, per month, in UZS"). Every item has accept / edit / drop options. Editing a role re-drafts the code's metrics before the metric list is shown again. `--yes` accepts everything (roles, kinds, business model and metrics) as `assumed`.
- **API:** `GET /v1/jobs/{id}/metrics` returns the draft with its roles, table kinds and business model. `POST /v1/jobs/{id}/metrics` with YAML (including an optional `roles:` block, §1) confirms it, and the job then continues. A role outside the vocabulary or a column that doesn't exist is refused with a typed error (`UNKNOWN_ROLE`, `UNKNOWN_COLUMN`; interfaces §1).
- **MCP:** a `confirm_metrics` tool takes the YAML, roles included. If the job was started with `auto_confirm=true`, every definition and role is `assumed`.
- **Recording:** each assumed definition becomes an `Assumption` in the report and is attached to every finding using it. So does each assumed role that an analysis reads ("Column ‘Std cost’ read as unit cost").
- **Roles not posted** stay as the detector proposed them, with `status: assumed`.
- **As built (PR 6):** the CLI asks one question for all the roles ("accept all, edit one by one, or drop"; the last leaves them unconfirmed as assumptions), then the business model, then each metric. A changed role or model is sent as a roles-only revision, the metrics are drafted again and shown, and the metric pass follows; the final request carries the metrics and every role shown. The API's `GET` returns `yaml` (metrics and roles, ready to post back), `metrics_yaml`, `metrics`, `roles` (with `evidence`, `status`, `source`), `columns_without_role`, `table_kinds`, `business_model`, `vocabulary` and `business_models`; `POST` follows semantics §5 "As built". MCP prints the same screen as text (`confirm_metrics` takes the YAML) and the viewer renders it as one form. Every role posted is confirmed; the rest stay assumed.
- **Reuse:** confirmed definitions and roles can be saved to `./agentic-analytics.metrics.yaml` and reused on the next run (P2: per-client memory).

## 4. Compilation

Each metric compiles to a parameterized SQL template: `metric(id, period_range, dimension_filters?, group_by?)`. All facts are produced through this compiler, so every number is tied to a `metric_id` and its SQL. Unit tests check the compiled SQL for every metric type against hand-computed answers. A ratio or derived metric joins its inputs' CTEs on period (and groups); each join side has its own alias (`m1 AS j0 FULL JOIN m2 AS j1`), so the SQL stays valid when the same CTE appears on both sides.

## 5. Objective

The user is asked once for the business goal. A default is used if they skip it: "grow profit while protecting key customers". The objective is stored in `report.objective` and used by DECIDE to rank recommendations. Argo-Bench showed that stating the objective lifts decision quality a lot.
