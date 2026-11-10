import { describe, expect, test, vi } from "vitest";
import { applyBlueprint, summarizeApplyResult } from "../../src/blueprint/apply.js";
import { BlueprintSchema } from "../../src/blueprint/schema.js";

describe("applyBlueprint", () => {
  test("dryRun sends nothing", async () => {
    const deps = { teleport: vi.fn(), run: vi.fn() };
    const r = await applyBlueprint(
      deps,
      BlueprintSchema.parse({ ops: [{ op: "set", at: [0, 0, 0], block: "stone" }] }),
      [5, 5, 5],
      { dryRun: true },
    );
    expect(r).toEqual({ commands: ["/setblock 5 5 5 stone"], sent: 0, messages: [] });
    expect(deps.run).not.toHaveBeenCalled();
    expect(deps.teleport).not.toHaveBeenCalled();
  });
  test("teleports to center then runs", async () => {
    const order: string[] = [];
    const deps = {
      teleport: vi.fn(async () => {
        order.push("tp");
      }),
      run: vi.fn(async (c: string[]) => {
        order.push("run");
        return { sent: c.length, messages: [] };
      }),
    };
    const r = await applyBlueprint(
      deps,
      BlueprintSchema.parse({ ops: [{ op: "fill", from: [0, 0, 0], to: [10, 0, 10], block: "stone" }] }),
      [0, 64, 0],
    );
    expect(deps.teleport).toHaveBeenCalledWith([5, 64, 5]);
    expect(deps.run).toHaveBeenCalledWith(["/fill 0 64 0 10 64 10 stone"]);
    expect(order).toEqual(["tp", "run"]);
    expect(r.sent).toBe(1);
  });
  test("empty blueprint does nothing", async () => {
    const deps = { teleport: vi.fn(), run: vi.fn() };
    const r = await applyBlueprint(deps, BlueprintSchema.parse({ ops: [] }), [0, 0, 0]);
    expect(r).toEqual({ commands: [], sent: 0, messages: [] });
    expect(deps.teleport).not.toHaveBeenCalled();
    expect(deps.run).not.toHaveBeenCalled();
  });
});

describe("summarizeApplyResult", () => {
  test("dry run keeps the command list", () => {
    const r = { commands: ["/setblock 0 0 0 stone"], sent: 0, messages: [] };
    expect(summarizeApplyResult(r, true)).toBe(r);
  });
  test("counts routine success messages and keeps only the others", () => {
    const r = summarizeApplyResult(
      {
        commands: ["/fill 0 0 0 1 1 1 stone", "/setblock 0 0 0 stone", "/setblock 1 0 0 bogus"],
        sent: 3,
        messages: [
          "Teleported urzk_ to 0.5, 1.0, 0.5",
          "Successfully filled 8 block(s)",
          "Changed the block at 0, 0, 0",
          "Unknown block type 'minecraft:bogus'",
        ],
      },
      false,
    );
    expect(r).toEqual({
      commandCount: 3,
      sent: 3,
      successMessages: 3,
      otherMessages: ["Unknown block type 'minecraft:bogus'"],
      otherMessagesTruncated: 0,
    });
  });
  test("truncates other messages after 50", () => {
    const messages = Array.from({ length: 60 }, (_, i) => `err ${i}`);
    const r = summarizeApplyResult({ commands: [], sent: 60, messages }, false);
    expect(r).toMatchObject({ otherMessages: messages.slice(0, 50), otherMessagesTruncated: 10 });
  });
});
