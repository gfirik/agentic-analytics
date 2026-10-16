---
title: How quality is measured
description: Generated businesses with planted events, honest scoring, and the bars a release must meet.
sidebar:
  order: 1
---

The eval suite runs the whole engine on **30 generated businesses** — 10 archetypes (coffee roaster, printing shop, clinic, online store, distributor, restaurant, SaaS, logistics, construction supplier, agency) × 3 seeded variants — and scores each report against an answer key.

Each dataset plants:

- a key client lost after a price rise (all variants),
- a supplier switch that raises refunds (variant 2),
- a new product cannibalizing an old one (variant 3),
- a ×1000 typo and ambiguous dates, a noise blip inside the band and every December's seasonal peak as **distractors**, and cause documents next to coincidental and irrelevant ones.

**Scoring never reads wording.** A finding matches a planted event by what its code-written first claim states — the metric (mapped by definition, not name), the member, and a comparison that spans the event. Recall counts an event only with the correct driver. A top recommendation about anything else is a miss.

| Metric | v0.1 bar |
|---|---|
| Number mismatches | 0 |
| Planted recall@5 | ≥ 80% |
| Driver accuracy | ≥ 90% |
| Cause grade accuracy | ≥ 80% |
| Distractor FP rate | ≤ 10% |
| Quality-issue recall | ≥ 90% |
| Citation precision | ≥ 95% |
| Recommendation relevance | ≥ 70% |

## Reproduce

```bash
bun run eval -- --suite full --model baseline                        # offline, ~3 minutes
bun run eval -- --suite smoke --small-model --model ollama:qwen3.5:9b  # a real model
```

The **baseline** is a scripted heuristic used to check the harness; it is never presented as model quality. Results: [Eval results](../results/).
