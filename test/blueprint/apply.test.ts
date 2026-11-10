import { describe, expect, test, vi } from "vitest";
import { applyBlueprint } from "../../src/blueprint/apply.js";
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
