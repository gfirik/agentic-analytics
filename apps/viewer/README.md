# @agentic-analytics/viewer

The web viewer (Vite + React). It has an upload page, a live job view whose pipeline stages light up as they run, a metric confirmation form and the embedded report.

- **Status:** built in M10.
- **Spec:** docs/specs/interfaces.md §5

`aa serve` hosts the built viewer at `/`. Build it once:

```bash
bun run --filter @agentic-analytics/viewer build   # → apps/viewer/dist
bun run aa serve                                   # http://127.0.0.1:8080/
```

For development, `bun run --filter @agentic-analytics/viewer dev` runs Vite with `/v1` proxied to the engine on :8080. When the API requires a token, the viewer reads it from `localStorage["aa-token"]`. Events come over SSE through `fetch` so the token can be sent.

## Public API

- `createApi(base, token?, fetch?)`: the API calls the viewer makes.
- `reduce(view, event)` and `initialView()`: the live job state, folded from job events.
