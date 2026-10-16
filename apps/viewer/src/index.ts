// Public API of @agentic-analytics/viewer (docs/specs/interfaces.md §5): the state reducer and API client, used by
// the React app (src/App.tsx, built with Vite into dist/ and served by `aa serve`).
export { type Api, createApi } from "./api.ts";
export { initialView, type JobView, reduce, STAGES, type StageState } from "./state.ts";
