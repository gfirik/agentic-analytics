---
title: Decisions and impact ranges
description: Recommendations that cite findings, carry a computed range, and name the check that will judge them.
sidebar:
  order: 10
---

The planner proposes candidate actions; **code** decides which survive. Each candidate must:

- cite at least one finding (`because`);
- request an impact **scenario** — `recover_share`, `price_change`, `remove_excess_rate`, `retain_at_risk` — whose low and high ends are computed in code from facts and bounded parameters (no number from the model);
- name a **check**: a metric, a comparator, a threshold fact, and a date after the data.

Candidates are ranked by |impact midpoint| × confidence ÷ effort, and the top 2–5 are kept. A recommendation can also carry a **not advised** line — the tempting wrong move ("Don't cut retail prices; retail is growing").

From the example: *Offer wholesale accounts a volume-tier discount to win back paused standing orders* — expected impact 3,995 to 7,191 next quarter, from recovering 50–90% of the lost 8,500 net of a 6% discount; check revenue ≥ the March level by 30 September.

If the model can't produce valid actions even after validation retries, the report ships with its findings and no recommendations, and says why.
