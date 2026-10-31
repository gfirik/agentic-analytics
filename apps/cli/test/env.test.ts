// The CLI names a .env it reads from outside the repo (security §6).
import { describe, expect, it } from "vitest";
import { dotEnvNotice } from "../src/env.ts";

describe(".env notice", () => {
  it("is silent for the repo's own .env and names any other", () => {
    expect(dotEnvNotice("/home/u/agentic-analytics", "/home/u/agentic-analytics")).toBeUndefined();
    expect(dotEnvNotice("/home/u/agentic-analytics/", "/home/u/agentic-analytics/apps/cli/src/../../..")).toBeUndefined();
    expect(dotEnvNotice("/home/u/clients/acme", "/home/u/agentic-analytics")).toBe("aa: reading settings from /home/u/clients/acme/.env");
  });
});
