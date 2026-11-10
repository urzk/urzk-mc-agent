import { describe, expect, test } from "vitest";
import { loadConfig } from "../../src/config.js";
import { BotManager } from "../../src/bot/manager.js";
import { createServer } from "../../src/server/createServer.js";
import { callTool, listToolNames } from "../helpers/mcp.js";

function makeServer() {
  const config = loadConfig({});
  return createServer({ bots: new BotManager(config), config });
}

describe("createServer", () => {
  test("lists connection and command tools", async () => {
    const names = await listToolNames(makeServer());
    expect(names).toEqual(
      expect.arrayContaining(["connect", "disconnect", "get_status", "run_command", "run_commands"]),
    );
  });
  test("run_command without connection returns isError", async () => {
    const res = await callTool(makeServer(), "run_command", { command: "/time set day" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/connect/);
  });
  test("run_commands without connection returns isError", async () => {
    const res = await callTool(makeServer(), "run_commands", { commands: ["/time set day"] });
    expect(res.isError).toBe(true);
  });
  test("get_status without connection", async () => {
    const res = await callTool(makeServer(), "get_status", {});
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(res.content[0].text)).toMatchObject({ connected: false });
  });
  test("disconnect without connection is harmless", async () => {
    const res = await callTool(makeServer(), "disconnect", {});
    expect(res.isError).toBeFalsy();
  });
});
