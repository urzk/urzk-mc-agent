import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";
import { allowDoors, closedDoorsAhead, closedDoorsNear, isHandDoor, startDoorOpener } from "../../src/bot/doors.js";

type Fake = { name: string; open?: boolean };

function world(blocks: Record<string, Fake>) {
  return (x: number, y: number, z: number) => {
    const b = blocks[`${x},${y},${z}`];
    if (!b) return { name: "air", position: { x, y, z }, getProperties: () => ({}) };
    return { name: b.name, position: { x, y, z }, getProperties: () => (b.open === undefined ? {} : { open: b.open }) };
  };
}

describe("isHandDoor", () => {
  test("wooden doors yes, iron door and trapdoors no", () => {
    expect(isHandDoor("oak_door")).toBe(true);
    expect(isHandDoor("dark_oak_door")).toBe(true);
    expect(isHandDoor("iron_door")).toBe(false);
    expect(isHandDoor("oak_trapdoor")).toBe(false);
    expect(isHandDoor("stone")).toBe(false);
  });
});

describe("allowDoors", () => {
  function makeMovements(neighbors: { x: number; y: number; z: number }[] = []) {
    return {
      getBlock: (p: { x: number; y: number; z: number } | null, dx: number) => {
        const x = (p?.x ?? 0) + dx;
        if (x === 0) return { name: "oak_door", safe: false, physical: true };
        if (x === 1) return { name: "iron_door", safe: false, physical: true };
        return { name: "stone", safe: false, physical: true };
      },
      getNeighbors: (_node: unknown) => neighbors,
    };
  }

  test("marks hand doors as passable and leaves other blocks alone", () => {
    const movements = makeMovements();
    allowDoors(movements as never);
    expect(movements.getBlock({ x: 0, y: 0, z: 0 }, 0)).toMatchObject({ safe: true, physical: false });
    expect(movements.getBlock({ x: 0, y: 0, z: 0 }, 1)).toMatchObject({ safe: false, physical: true });
    expect(movements.getBlock({ x: 0, y: 0, z: 0 }, 2)).toMatchObject({ safe: false, physical: true });
  });

  test("drops diagonal and parkour moves into or out of a door cell", () => {
    const into = [
      { x: 0, y: 1, z: 5 }, // straight into the door cell (x=0): kept
      { x: 0, y: 2, z: 4 }, // diagonal into the door cell: dropped
      { x: 2, y: 1, z: 4 }, // diagonal between non-door cells: kept
    ];
    const m1 = makeMovements(into);
    allowDoors(m1 as never);
    expect(m1.getNeighbors({ x: 1, y: 1, z: 5 } as never)).toEqual([into[0], into[2]]);

    const out = [
      { x: 3, y: 1, z: 6 }, // parkour out of the door cell: dropped
      { x: -1, y: 1, z: 6 }, // straight out: kept
    ];
    const m2 = makeMovements(out);
    allowDoors(m2 as never);
    expect(m2.getNeighbors({ x: 0, y: 1, z: 6 } as never)).toEqual([out[1]]);
  });
});

describe("closedDoorsAhead", () => {
  const at = world({
    "5,1,0": { name: "oak_door", open: false },
    "5,2,0": { name: "oak_door", open: false },
    "9,1,0": { name: "oak_door", open: false },
    "3,1,0": { name: "oak_door", open: true },
  });
  const path = [3, 4, 5, 6, 7, 8, 9].map((x) => ({ x: x + 0.5, y: 1, z: 0.5 }));

  test("returns closed doors on the path within range, once per door", () => {
    expect(closedDoorsAhead(at, { x: 3.5, y: 1, z: 0.5 }, path, 2.5)).toEqual([[5, 1, 0]]);
  });

  test("nothing when out of range", () => {
    expect(closedDoorsAhead(at, { x: 0.5, y: 1, z: 0.5 }, path, 2.5)).toEqual([]);
  });
});

describe("closedDoorsNear", () => {
  test("lists closed doors (lower half) around a point, including iron doors", () => {
    const at = world({
      "1,1,0": { name: "iron_door", open: false },
      "1,2,0": { name: "iron_door", open: false },
      "0,1,2": { name: "oak_door", open: true },
    });
    expect(closedDoorsNear(at, { x: 0.5, y: 1, z: 0.5 }, 2)).toEqual([{ name: "iron_door", pos: [1, 1, 0] }]);
  });
});

describe("startDoorOpener", () => {
  test("opens a closed door that the current path goes through, and stops listening", async () => {
    const blocks: Record<string, Fake> = { "2,1,0": { name: "oak_door", open: false } };
    const at = world(blocks);
    const bot = Object.assign(new EventEmitter(), {
      entity: { position: { x: 0.5, y: 1, z: 0.5 } },
      blockAt: vi.fn((p: { x: number; y: number; z: number }) => at(p.x, p.y, p.z)),
      activateBlock: vi.fn(async () => {
        blocks["2,1,0"].open = true;
      }),
    });
    const stop = startDoorOpener(bot as never);
    bot.emit("path_update", { path: [1, 2, 3].map((x) => ({ x: x + 0.5, y: 1, z: 0.5 })) });
    bot.emit("physicsTick");
    bot.emit("physicsTick"); // second tick must not toggle it again
    await new Promise((r) => setTimeout(r, 0));
    expect(bot.activateBlock).toHaveBeenCalledTimes(1);
    stop();
    expect(bot.listenerCount("physicsTick")).toBe(0);
    expect(bot.listenerCount("path_update")).toBe(0);
  });
});
