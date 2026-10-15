---
description: Autonomous loop. Pick the next milestone from STATE.md and run full cycles until a human gate, a blocker, or the end of the roadmap.
---

You are running autonomously. Nobody is watching, so don't ask questions. Use reasonable defaults consistent with the specs and record them. Stop only for the reasons in AGENTS.md §7.

1. Read AGENTS.md and docs/progress/STATE.md.
2. Check whether to stop:
   - **Any milestone is BLOCKED or AWAITING_REVIEW:** run `bash scripts/notify.sh "Autopilot paused: <milestone> is <status>"`, print why, and stop.
   - **Every milestone is DONE:** notify "Roadmap complete" and stop.
3. Take the first milestone in roadmap order whose status is TODO or IN_PROGRESS. If it's IN_PROGRESS, resume from its branch and plan file.
4. Run the full cycle for it, exactly as in `.claude/commands/milestone.md` (steps 1–11).
5. If the milestone was merged and you still have plenty of context left, continue with the next one (step 2). Otherwise stop cleanly. The outer script `scripts/autopilot.sh` starts a fresh session for the next milestone.
