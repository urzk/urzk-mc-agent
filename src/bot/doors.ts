import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";

/**
 * mineflayer-pathfinder treats every door as a wall: its `canOpenDoors` only handles
 * fence gates, and a 2-high door is never "safe" to stand in, even when open.
 * These helpers let move_to path through wooden doors and open them on the way.
 */

type XYZ = { x: number; y: number; z: number };
type BlockLike = { name: string; getProperties(): Record<string, unknown> };
type BlockLookup = (x: number, y: number, z: number) => BlockLike | null;

/** Doors a player can open by hand (not iron doors, not trapdoors). */
export function isHandDoor(name: string): boolean {
  return name.endsWith("_door") && name !== "iron_door";
}

function isClosed(b: BlockLike): boolean {
  return b.getProperties().open !== true;
}

type MovementsLike = {
  getBlock: (...args: never[]) => unknown;
  getNeighbors: (...args: never[]) => unknown;
};

/**
 * Make the pathfinder treat wooden doors as walkable (open or closed). Moves into or out of
 * a door cell are limited to straight steps to a side neighbour: diagonal or parkour moves
 * catch on the open door panel and leave the bot stuck.
 */
export function allowDoors(movements: MovementsLike): void {
  const origBlock = movements.getBlock.bind(movements) as (...args: unknown[]) => Record<string, unknown> | null;
  const getBlock = (...args: unknown[]) => {
    const b = origBlock(...args);
    if (b && typeof b.name === "string" && isHandDoor(b.name)) {
      b.safe = true;
      b.physical = false;
    }
    return b;
  };
  movements.getBlock = getBlock as never;
  const isDoorAt = (p: XYZ) => {
    const b = getBlock(p, 0, 0, 0);
    return !!b && typeof b.name === "string" && isHandDoor(b.name);
  };
  const origNeighbors = movements.getNeighbors.bind(movements) as (node: XYZ) => XYZ[];
  movements.getNeighbors = ((node: XYZ) =>
    origNeighbors(node).filter((m) => {
      if (Math.abs(m.x - node.x) + Math.abs(m.z - node.z) <= 1) return true;
      return !isDoorAt(node) && !isDoorAt(m);
    })) as never;
}

/** Closed wooden doors at the feet cells of path nodes within `range` of the bot. */
export function closedDoorsAhead(at: BlockLookup, pos: XYZ, path: XYZ[], range: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const seen = new Set<string>();
  for (const n of path) {
    if (Math.hypot(n.x - pos.x, n.y - pos.y, n.z - pos.z) > range) continue;
    const c: [number, number, number] = [Math.floor(n.x), Math.floor(n.y), Math.floor(n.z)];
    const key = c.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    const b = at(...c);
    if (b && isHandDoor(b.name) && isClosed(b)) out.push(c);
  }
  return out;
}

/** Closed doors (any kind, lower half only) within `radius` blocks of a point; for error hints. */
export function closedDoorsNear(at: BlockLookup, pos: XYZ, radius: number): { name: string; pos: [number, number, number] }[] {
  const out: { name: string; pos: [number, number, number] }[] = [];
  const [cx, cy, cz] = [Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)];
  for (let x = cx - radius; x <= cx + radius; x++)
    for (let y = cy - 1; y <= cy + 1; y++)
      for (let z = cz - radius; z <= cz + radius; z++) {
        const b = at(x, y, z);
        if (!b || !b.name.endsWith("_door") || !isClosed(b)) continue;
        const below = at(x, y - 1, z);
        if (below && below.name === b.name) continue; // upper half
        out.push({ name: b.name, pos: [x, y, z] });
      }
  return out;
}

/**
 * While the pathfinder runs, right-click closed wooden doors on the upcoming path.
 * Returns a function that detaches the listeners.
 */
export function startDoorOpener(bot: Bot, range = 2.5): () => void {
  let path: XYZ[] = [];
  const pending = new Set<string>();
  const at: BlockLookup = (x, y, z) => bot.blockAt(new Vec3(x, y, z)) as BlockLike | null;
  const onPath = (r: { path?: XYZ[] }) => {
    path = r.path ?? [];
  };
  const onTick = () => {
    if (path.length === 0) return;
    for (const c of closedDoorsAhead(at, bot.entity.position, path, range)) {
      const key = c.join(",");
      if (pending.has(key)) continue;
      const block = bot.blockAt(new Vec3(...c));
      if (!block) continue;
      pending.add(key);
      bot
        .activateBlock(block)
        .catch(() => {})
        .finally(() => setTimeout(() => pending.delete(key), 500));
    }
  };
  bot.on("path_update" as never, onPath as never);
  bot.on("physicsTick", onTick);
  return () => {
    bot.off("path_update" as never, onPath as never);
    bot.off("physicsTick", onTick);
  };
}
