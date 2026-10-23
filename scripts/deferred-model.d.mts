// Types for scripts/deferred-model.mjs (plain JS so cron runs it with node and no build step).
export interface ServedModel {
  id: string;
  active?: boolean;
  context_window?: number;
}
export type Pick = { model: string; shared: string | null; error?: undefined } | { error: string; model?: undefined };
export function routeModels(value: string | undefined): string[];
export function pickModel(served: ServedModel[], env: Record<string, string | undefined>): Pick;
