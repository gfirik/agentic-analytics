---
description: Run one full milestone cycle (plan → build → gate → review → QA → PR → CI → merge or gate)
argument-hint: <milestone number, e.g. 3>
---

Run the full cycle for milestone M$ARGUMENTS, exactly as described in docs/AUTOPILOT.md §2. AGENTS.md rules are binding.

1. **Orient.**
   - Read AGENTS.md, docs/progress/STATE.md, docs/ROADMAP.md (M$ARGUMENTS) and every spec it references.
   - If no `.git` exists and this is M0, first run `git init -b main`, commit everything as `chore: initial planning docs`, and run `gh repo create gfirik/agentic-analytics --private --source=. --push`. If `gh` isn't authenticated, mark M0 BLOCKED with the message "run: gh auth login" and stop.
2. **Branch.**
   - Run `git switch main && git pull --ff-only`, then `git switch -c m$ARGUMENTS/<short-name>`.
   - Set M$ARGUMENTS to IN_PROGRESS in STATE.md.
3. **Plan.** Write docs/plans/m$ARGUMENTS.md: the tasks in order, the files to touch, the tests to write, the risks, and how each acceptance criterion will be proven.
4. **Build.**
   - Work test-first for every numeric or parsing behaviour.
   - Make small Conventional Commits.
   - When a spec leaves a choice open, choose the option most consistent with the specs and record it under "Decisions made by agents" in STATE.md.
   - Never wait on a missing model, service or key. Build against FakeModel and in-process embeddings, mark real-model checks DEFERRED in STATE.md with the exact command, and continue.
5. **Gate.** Run `bash scripts/gate.sh` until it passes.
6. **Review.**
   - Delegate to the `spec-reviewer` subagent with: the milestone number, `git diff main...HEAD --stat`, and the plan file.
   - Fix every MUST item. Repeat up to 3 rounds.
   - If MUST items still remain after 3 rounds, fix what you can. Record the rest under "Known gaps carried forward", note it in the PR, and continue. Only a failing gate (broken tests or build) prevents merging.
7. **QA.**
   - Delegate to the `qa` subagent to run every acceptance demo for M$ARGUMENTS from a clean state.
   - Fix any failure, then re-run the gate, review and QA as needed.
8. **PR.**
   - Update STATE.md in the branch: status, demo command, notes, known gaps.
   - Push, then `gh pr create` with the template filled in (acceptance checklist, demo output from QA, reviewer verdict, decisions, new dependencies with reasons).
   - Add the PR link to STATE.md, commit and push.
9. **CI.** Run `gh pr checks --watch`. If anything fails, fix it, push, and repeat, up to 3 rounds. After that, record the failure under Blockers with the logs, and fix it in a fresh attempt on the next run. Only mark BLOCKED (hard stop) if CI itself can't run, for example because of missing permissions.
10. **Finish.**
    - **If STATE.md marks M$ARGUMENTS with gate `yes`:** set the status to AWAITING_REVIEW, push, run `bash scripts/notify.sh "M$ARGUMENTS ready for your review: <PR url>"`, and stop.
    - **If the gate is `notify`:** finish as below, and also send `"M$ARGUMENTS merged. Please review when convenient: <PR url>"`.
    - **Otherwise:**
      1. Set the status to DONE in the branch and push.
      2. Run `gh pr merge --squash --delete-branch` once checks pass.
      3. Run `git switch main && git pull --ff-only`.
      4. Run `bash scripts/notify.sh "M$ARGUMENTS merged: <PR url>"`.
11. **Report.** End with a 5-line summary: what shipped, the demo, the PR, gaps, and what's next.
