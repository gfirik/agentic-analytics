# Examples

## coffee-roaster

A small specialty coffee roaster's first half of 2026: a sales workbook (6,260 orders plus the owner's monthly summary), a wholesale price list (PDF), an email from a hotel customer, and operations notes (DOCX). It is the demo input for the README, the docs and the demo GIF.

The files are byte-identical copies of `evals/datasets/coffee-roaster-v1/files`, which are generated from integer-cent ground truth. `scripts/test/examples.test.ts` keeps the two in step. The answer key (`evals/datasets/coffee-roaster-v1/answers.yaml`) lists what a correct report finds:

- revenue −17.9% in April, driven by wholesale after a hotel group paused its standing order over the price rise;
- the refund rate rising from 1.2% to 3.4% after a packaging supplier switch;
- a ×1000 typo in the costs;
- dd/mm date ambiguity.

```bash
bun run aa analyze examples/coffee-roaster --yes --currency USD --today 2026-07-01 --open
```
