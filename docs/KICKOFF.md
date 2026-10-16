# Kickoff: how to start building

The build runs on autopilot (see docs/AUTOPILOT.md). You start it, and it works through the roadmap on its own: it plans, builds, tests, reviews, pushes, opens PRs, waits for CI, merges and moves to the next milestone. It stops only at the human gates (M1, M11, M12) or on a real blocker, and messages you on Telegram if you've set that up.

## One-time setup

1. Install Node 22+, install Bun (`curl -fsSL https://bun.sh/install | bash`; it is the package manager, Node stays the runtime), install the GitHub CLI (`gh`), and log in with `gh auth login` as gfirik.
2. Optional: set `AA_TG_TOKEN` and `AA_TG_CHAT` in `~/.bashrc` for Telegram notifications (docs/AUTOPILOT.md §4).
3. The harness files (Claude commands, subagents, settings) get installed by the first-run prompt below.

## First run: install the loop, then M0 (interactive, about 2 minutes of your attention)

Open Claude Code in `~/startups/agentic-analytics` and paste:

```
Set up the autopilot harness for this repo, then run milestone 0.
1. Move setup/claude/commands/* to .claude/commands/, setup/claude/agents/* to .claude/agents/, and setup/github/pull_request_template.md to .github/. Then delete setup/.
2. Create .claude/settings.json as described in docs/AUTOPILOT.md §7:
   - an allow-list for bun, bunx, node, git (no push to main, no force push), gh pr/run/auth status, `gh repo create gfirik/agentic-analytics`, `bash scripts/*`, `docker compose`, `ollama list/pull` and basic file tools;
   - denies for pushing to main, force pushes, sudo, curl/wget, `gh repo delete/edit` and reading .env files;
   - a PostToolUse hook on Edit|Write|MultiEdit running `bash scripts/hooks/format.sh`;
   - a Stop hook running `bash scripts/hooks/stop-gate.sh`.
   Show me the file before saving it.
3. Run `chmod +x scripts/*.sh scripts/hooks/*.sh`.
4. Read AGENTS.md and docs/AUTOPILOT.md, then run /milestone 0.
```

Restart Claude Code once after step 2, so the new commands and settings load. Then type `/milestone 0` if it hasn't started.

## From then on (autonomous)

```bash
cd ~/startups/agentic-analytics
bash scripts/autopilot.sh
```

Leave it running. Check progress any time with `/status` inside Claude Code, or by reading docs/progress/STATE.md.

## When it pauses

- **Human gate (M1, M11, M12).**
  1. Review the PR on GitHub.
  2. Merge it, or tell Claude "approved, merge M1".
  3. Run `bash scripts/autopilot.sh` again.
- **Blocker.** STATE.md lists the exact question under "Blockers".
  1. Answer it: edit the spec, or tell Claude in a session.
  2. Set the milestone back to TODO or IN_PROGRESS.
  3. Restart the loop.
