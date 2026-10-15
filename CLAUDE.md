# CLAUDE.md

All instructions for AI agents live in AGENTS.md. Read it fully before any task.

@AGENTS.md

Quick reminders:
- Read the milestone in docs/ROADMAP.md and the relevant docs/specs/* file before coding.
- The model never does arithmetic. Every number comes from SQL or a deterministic function, with provenance attached.
- Free and local only: providers are `ollama` and `openai-compatible`. Tests use FakeModel and never touch the network.
- Work on a branch `m<N>/<task>`, use Conventional Commits, run `bun run check` before every push, open a PR, and never push to main.
