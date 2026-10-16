# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on this repository. Please don't open a public issue. Include steps to reproduce, the affected version or commit, and the impact you see.

You'll get an acknowledgement within 7 days. Confirmed issues are fixed in a patch release, and you'll be credited in the release notes unless you'd rather not be.

## Scope

The engine reads untrusted files and, when enabled, untrusted web pages. These are in scope:

- prompt injection that changes a number, a claim or a tool call, or that reaches a model other than the quarantined extractor;
- data leaving the machine through web queries, fetched URLs or model providers;
- SSRF through the web fetcher;
- escaping the fixed tool set (code execution);
- unauthenticated access to the HTTP API or MCP from another origin;
- path traversal through uploads, job ids or static files.

How these are handled: docs/specs/security.md and the docs page "Security and prompt injection".

Out of scope: issues that need an attacker who already has shell access to the host, and the behaviour of third-party model providers.
