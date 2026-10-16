---
title: Metric layer
description: Why metric definitions are drafted, shown in plain words and confirmed before any number is computed.
sidebar:
  order: 4
---

The most common failure of AI analysts is computing the right arithmetic on the wrong quantity: gross instead of net, a neighbouring column, the wrong period. So before measuring anything the engine drafts **metric definitions** and shows them in plain words:

> Revenue = sum of `amount` where status is empty or status is not refunded, per month, in USD (assumed)

```yaml
metrics:
  - id: revenue
    label: Revenue
    type: sum                  # sum | count | count_distinct | avg | ratio | derived
    table: t_t1
    expression: amount
    filters: ["status IS NULL OR status NOT IN ('refunded')"]
    time_column: date
    unit: currency
    currency: USD
    dimensions: [customer, channel, product]
    status: assumed            # confirmed | assumed
```

That is the definition the deterministic fallbacks drafted for the coffee example.

Every proposal — from the model or the deterministic fallbacks — is **validated by code**: tables and columns exist, types fit the aggregation, filters parse, ratios are guarded. Invalid ones are refused with a reason.

You confirm, edit or drop each definition in the CLI review, the viewer, the API (`POST /v1/jobs/{id}/metrics`) or MCP (`confirm_metrics`). With `--yes` they stay **assumed**, and every finding that uses an assumed definition says so. Each metric compiles to parameterized SQL; every fact is produced through that compiler, and the verifier checks each fact against its definition (V4).
