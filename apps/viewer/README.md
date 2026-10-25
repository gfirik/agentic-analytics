# @agentic-analytics/viewer

The web viewer (Vite + React). It has an upload page, a live job view whose pipeline stages light up as they run, one confirmation form for the column roles (a select each, with evidence), the table kinds, the business model and the drafted metrics (changing a role and pressing "Update the drafts" shows the metrics drafted from it), and the embedded report.

- **Status:** built in M10.
- **Spec:** docs/specs/interfaces.md §5

`aa serve` hosts the built viewer at `/`. Build it once:

```bash
bun run --filter @agentic-analytics/viewer build   # → apps/viewer/dist
bun run aa serve                                   # http://127.0.0.1:8080/
```

For development, `bun run --filter @agentic-analytics/viewer dev` runs Vite with `/v1` proxied to the engine on :8080. When the API requires a token, the viewer reads it from `localStorage["aa-token"]`; on a 401 the page says so and offers a token field that saves it there. Failed streams, reports and metric loads are shown in the page. Events come over SSE through `fetch` so the token can be sent.

## Public API

- `createApi(base, token?, fetch?)`: the API calls the viewer makes. A refusal throws `ApiError` (`status`, `code`); `errorText(err)` is what the page shows for it.
- `reduce(view, event)` and `initialView()`: the live job state, folded from job events.
