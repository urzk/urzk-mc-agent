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
  test("lists inspection and blueprint tools", async () => {
    const names = await listToolNames(makeServer());
    expect(names).toEqual(
      expect.arrayContaining(["read_blocks", "get_block", "wait_ticks", "apply_blueprint", "verify_blueprint"]),
    );
  });
  test("lists inventory tools", async () => {
    const names = await listToolNames(makeServer());
    expect(names).toEqual(
      expect.arrayContaining([
        "get_inventory", "set_hotbar_slot", "give_item", "equip", "drop", "open_container", "container_transfer",
      ]),
    );
  });
  test("lists movement tools", async () => {
    const names = await listToolNames(makeServer());
    expect(names).toEqual(
      expect.arrayContaining(["move_to", "teleport", "look_at", "interact_block", "place_block", "dig_block"]),
    );
  });
  test("lists the screenshot tool", async () => {
    expect(await listToolNames(makeServer())).toContain("screenshot");
  });
  test("run_script is registered only when enableScript is true", async () => {
    expect(await listToolNames(makeServer())).toContain("run_script");
    const config = loadConfig({ MC_AGENT_ENABLE_SCRIPT: "false" });
    const off = createServer({ bots: new BotManager(config), config });
    expect(await listToolNames(off)).not.toContain("run_script");
  });
  test("inspection and blueprint tools without connection return isError", async () => {
    for (const [name, args] of [
      ["read_blocks", { from: [0, 0, 0], to: [1, 1, 1], format: "list" }],
      ["get_block", { x: 0, y: 0, z: 0 }],
      ["wait_ticks", { n: 1 }],
      ["apply_blueprint", { blueprint: { ops: [{ op: "set", at: [0, 0, 0], block: "stone" }] }, origin: [0, 0, 0] }],
      ["verify_blueprint", { blueprint: { ops: [] }, origin: [0, 0, 0] }],
      ["move_to", { x: 0, y: 0, z: 0 }],
      ["teleport", { x: 0, y: 0, z: 0 }],
      ["look_at", { x: 0, y: 0, z: 0 }],
      ["interact_block", { x: 0, y: 0, z: 0 }],
      ["place_block", { x: 0, y: 0, z: 0, block: "stone" }],
      ["dig_block", { x: 0, y: 0, z: 0 }],
      ["run_script", { code: "return 1" }],
      ["screenshot", { position: [0, 0, 0], lookAt: [1, 0, 0] }],
    ] as const) {
      const res = await callTool(makeServer(), name, args as unknown as Record<string, unknown>);
      expect(res.isError, name).toBe(true);
    }
  });
  test("apply_blueprint dryRun works without a connection", async () => {
    const res = await callTool(makeServer(), "apply_blueprint", {
      blueprint: { ops: [{ op: "set", at: [0, 0, 0], block: "stone" }] },
      origin: [1, 2, 3],
      dryRun: true,
    });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(res.content[0].text).commands).toEqual(["/setblock 1 2 3 stone"]);
  });
  test("instructions mention creative gamemode", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const [c, s] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([makeServer().connect(s), client.connect(c)]);
    expect(client.getInstructions()).toMatch(/gamemode creative/);
    await client.close();
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

describe("BotManager spawn gating", () => {
  test("bot getter rejects a bot that has not spawned and hints at pending connect", () => {
    const bots = new BotManager(loadConfig({}));
    (bots as unknown as { current: object }).current = {};
    expect(() => bots.bot).toThrow(/接続処理中/);
    expect(bots.status().connected).toBe(false);
  });
});
