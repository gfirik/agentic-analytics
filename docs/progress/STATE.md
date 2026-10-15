# STATE: build ledger

This is the single source of truth for progress between agent sessions. Agents update it inside each milestone PR. Status values: `TODO` · `IN_PROGRESS` · `AWAITING_REVIEW` · `BLOCKED` · `DONE`.

Human gate values:
- `no`: merge and continue.
- `notify`: merge, continue, and message Firdavs to review when convenient.
- `yes`: stop at AWAITING_REVIEW until Firdavs approves. Only M12 is `yes`, because making the repo public and launching is his call.

## Milestones

| Milestone | Status | Human gate | PR | Demo command | Notes |
|---|---|---|---|---|---|
| M0 Foundation | IN_PROGRESS | no | | | |
| M1 Contracts & golden fixtures | TODO | notify | | | |
| M2 Ingestion | TODO | no | | | |
| M3 Workspace & profiling | TODO | no | | | |
| M4 Metric layer | TODO | no | | | |
| M5 Analysis library | TODO | no | | | |
| M6 Retrieval | TODO | no | | | |
| M7 Agent | TODO | no | | | |
| M8 Web lane | TODO | no | | | |
| M9 Verifier | TODO | no | | | |
| M10 Doors | TODO | no | | | |
| M11 Evals at scale | TODO | notify | | | |
| M12 Docs site & launch | TODO | yes | | | |

Order: M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8 → M9 → M10 → M11 → M12. In autopilot it runs sequentially. Parallel worktrees are an interactive option only.

## Blockers

_None._

<!-- Format: - [M<N>] <date> — <exact question or problem> — <what was tried> -->

## Deferred checks

These are checks that need something this machine doesn't have yet, such as a real LLM. Run them later.

_None yet._

<!-- Format: - [M<N>] <criterion> — <reason> — `<exact command to run>` -->

## Decisions made by agents

_None yet._

<!-- Format: - [M<N>] <decision> — <why> — <spec reference> -->

## Known gaps carried forward

_None yet._
