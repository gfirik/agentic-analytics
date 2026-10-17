---
title: Reference
description: The exact formats and settings, for when you need the precise field name or the method id.
sidebar:
  order: 0
---

These pages are the precise lookups. For *why* things work the way they do, see [How it works](../../how-it-works/pipeline/).

| Page | What it covers | Generated from |
|---|---|---|
| [Config](../config/) | Environment variables and `agentic-analytics.config.yaml`: models per role, free providers, the web lane, timeouts, where jobs live | — |
| [Metric YAML](../metric-yaml/) | The metric definition format you confirm before anything is measured (`aa metrics --save`) | — |
| [Report schema](../report-schema/) | Every field of `report.json` v1: facts with their computations, claims with citations and grades | the JSON Schema the engine validates against |
| [Insight templates and decomposers](../templates/) | The detection and decomposition methods by id (`trend.v1`, `contribution.v1`, `pvm.v1`, …) | — |

The HTTP API reference lives with the other doors: [HTTP API](../../use-it/http-api/), generated from the server's own OpenAPI spec.
