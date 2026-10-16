# @agentic-analytics/server

The HTTP API (Hono + `@hono/zod-openapi`). The OpenAPI spec is generated from the same Zod schemas that validate requests.

- **Status:** built in M10.
- **Spec:** docs/specs/interfaces.md §1

## Endpoints

| Method | Path | Does |
|---|---|---|
| POST | `/v1/jobs` | multipart `files[]` + `options` JSON (`web`, `objective`, `auto_confirm` (default true), `small_model`, `currency`, `today`) → `202 { job_id, status }` |
| GET | `/v1/jobs` | all jobs with their status |
| GET | `/v1/jobs/{id}` | status, current stage, progress %, timings, error |
| GET | `/v1/jobs/{id}/events` | SSE: the job's events so far, then live ones; the stream ends on `done`, `failed` or `awaiting_confirmation` |
| GET / POST | `/v1/jobs/{id}/metrics` | drafted metrics (YAML + plain words) / confirm or edit them (YAML body); the job resumes |
| GET | `/v1/jobs/{id}/report` | `report.json`, or `report.html` with `Accept: text/html` or `?format=html` |
| POST | `/v1/jobs/{id}/ask` | `{ question }` → verified claims, their facts, dropped claims |
| GET | `/v1/jobs/{id}/facts/{factId}` | the computation behind a number |
| POST | `/v1/jobs/{id}/resume` | continue a failed or interrupted job |
| DELETE | `/v1/jobs/{id}` | delete the job's folder |
| GET | `/v1/health`, `/openapi.json` | availability checks; the generated spec |
| * | `/mcp` | MCP over streamable HTTP |
| GET | `/` | the viewer (`apps/viewer/dist`) |

Only localhost names (plus `--host` and `AA_ALLOWED_HOSTS`) are answered; any other `Host` or `Origin` gets 403 (a DNS-rebinding guard). The bearer token is compared in constant time.

Errors are `{ error: { code, message } }`: 400 `BAD_REQUEST`, 404 `NOT_FOUND`, 409 `BUSY` / `NOT_READY`, and 401 when `API_TOKEN` is set and the bearer token is missing. An unexpected error is a 500 `INTERNAL` with a generic message; the details go to `onError` (the server log). CORS is off. The server listens on 127.0.0.1 unless `--host` says otherwise, and refuses a non-loopback address without a token (`ServeError` `NO_AUTH_ON_NETWORK`) unless `allowNoAuth` is set. Without the token, `/v1/health` reports only the engine and DuckDB.

## Public API

- `createApp(manager, options)`: the Hono app (`token`, `allowedHosts`, `health`, `mcp`, `viewerDir`, `maxUpload`, `today`, `onError`); `startServer(manager, { port, hostname, allowNoAuth, ... })`.
- `startServer(manager, options & { port, hostname })`: serves it on Node.

## Example

```bash
bun run aa serve --port 8080
curl -F 'files[]=@sales.xlsx' -F 'options={"auto_confirm":true}' http://127.0.0.1:8080/v1/jobs
```
