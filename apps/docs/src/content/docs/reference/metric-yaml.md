---
title: Metric YAML
description: The metric definition format.
---

```yaml
version: 1
grain: month
timezone: Asia/Tashkent
objective: "Grow monthly gross profit without losing wholesale clients"
metrics:
  - id: revenue
    label: Revenue
    type: sum                            # sum | count | count_distinct | avg | ratio | derived
    table: t_sales
    expression: amount
    filters: ["status <> 'refunded'"]
    time_column: order_date
    unit: currency                       # currency | percent | count | ratio | days | other
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
roles:                               # optional (M15): column roles you confirmed or the engine assumed
  - { table: t_sales, column: std_cost, role: unit_cost, status: confirmed }
  - { table: t_sales, column: note, role: none }       # dropped
business_model: { model: wholesale, status: assumed }   # optional
```

- Filters are a small, parsed language (comparisons, `IN`, `IS NULL`, `AND`/`OR`), compiled to parameterized SQL; anything else is refused.
- Ratios take metric or inline terms; derived metrics combine other metrics.
- `roles` and `business_model` are optional, and a file without them still loads. A `role` must be one of the vocabulary (an unknown one is refused as `UNKNOWN_ROLE`), and its `column` must exist in the table (`UNKNOWN_COLUMN`). When you send a file to confirm, every role in it is confirmed; a body with `roles` and no `metrics` drafts the metrics again from the roles and keeps waiting.
- `aa metrics <paths> --save agentic-analytics.metrics.yaml` writes confirmed definitions; `--metrics` reuses them.

The JSON Schema: [metrics.schema.json](https://github.com/gfirik/agentic-analytics/blob/main/packages/schema/json/metrics.schema.json).
