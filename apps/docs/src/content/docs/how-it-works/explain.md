---
title: Explain and causal grades
description: How the planner explains a finding, and why causal words are policed.
sidebar:
  order: 9
---

For each top finding, **code** states the observed change and its decomposition ("Revenue went from {{N12}} in 2026-03 to {{N11}} in 2026-04…"). The planner then investigates with fixed tools — `drill_down`, `decompose`, `search_documents`, `search_web`, `get_facts` — within a budget (25 calls per job, 8 per finding; halved in small-model mode), and writes explanations with a **causal grade**:

| Grade | When |
|---|---|
| `observed` | The decomposition itself ("wholesale is 108% of the drop") |
| `correlated` | The timing coincides with an event in a document |
| `document_supported` | A document states the link ("we are pausing our order because of the new price list") |
| `intervention_supported` | A dated intervention plus a change past the noise band in the affected segment only |

It must also record the alternatives it rejected and why. Code drops claims naming unknown facts or extracts, and downgrades a `document_supported` grade with no cited document. The verifier then rewrites causal wording ("because of" → "around the time of") anywhere the grade doesn't support it.

**Small-model mode** (`--small-model`, or from the model's profile) replaces the tool loop with a fill-in form: code runs one document search per finding, and the model only picks a title and which extracts relate, which code turns into quoted sentences.
