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
```

- Filters are a small, parsed language (comparisons, `IN`, `IS NULL`, `AND`/`OR`), compiled to parameterized SQL; anything else is refused.
- Ratios take metric or inline terms; derived metrics combine other metrics.
- `aa metrics <paths> --save agentic-analytics.metrics.yaml` writes confirmed definitions; `--metrics` reuses them.

The JSON Schema: [metrics.schema.json](https://github.com/gfirik/agentic-analytics/blob/main/packages/schema/json/metrics.schema.json).
