import { test, expect } from "vitest";
import { loadConfig } from "../src/config.js";

test("defaults", () => {
  expect(loadConfig({})).toEqual({ host: "localhost", port: 25565, username: "ClaudeBuilder",
    auth: "offline", version: undefined, enableScript: true });
});
test("reads env", () => {
  const c = loadConfig({ MC_HOST: "mc.local", MC_PORT: "25566", MC_USERNAME: "Bob",
    MC_AUTH: "microsoft", MC_VERSION: "1.21.4", MC_AGENT_ENABLE_SCRIPT: "false" });
  expect(c).toEqual({ host: "mc.local", port: 25566, username: "Bob", auth: "microsoft",
    version: "1.21.4", enableScript: false });
});
test("rejects bad auth", () => { expect(() => loadConfig({ MC_AUTH: "xbox" })).toThrow(/MC_AUTH/); });
