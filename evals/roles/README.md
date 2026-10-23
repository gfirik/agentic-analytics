# Role labels (M15, docs/specs/accuracy.md §11)

`labels.yaml` is the hand-labelled answer file for the role detector (docs/specs/semantics.md): the role of every column and the kind of every table, for Online Retail II, NZ card spend, hotel bookings and the 30 generated businesses (two shared header layouts, `Orders` and `Costs`, expanded per dataset by `expandRoleLabels` in `evals/runner/src/role-labels.ts`). It was written from the raw files and the role vocabulary before any detector existed, so it could not be fitted to one.

Fields per column: `role`, `accept` (other roles that are also right), `agrees` (the blind re-labelling gave the same primary role), `note` (how a disagreement was settled). Per entry: `review` (who, when, columns labelled, columns agreed, table kind agreed).

## Independent re-labelling

A separate Sonnet subagent was given only the vocabulary and kind rules (copied from semantics.md §1 and §3) and a sample of each table (header, first rows, most common values, numeric range). It never saw this file or its rationale, and labelled every column. Where its primary role differed, the disagreement was settled by the spec (the `note`) and the other role went into `accept` when it was defensible. It labelled the generated layouts from 10 tables of 5 businesses, not all 30; the test checks that all 30 have the same headers. This review is agent-reviewed, not maintainer-reviewed, and the author and reviewer are the same model family, so shared blind spots are possible.

Checks: `bunx vitest run evals/runner/test/role-labels.test.ts` (schema, vocabulary equals the spec's table, generated headers match their layout; real files are checked when `bun run eval:real:fetch` has run). The detector and `aa eval --suite roles` come in M15 PR 4.
