import type { Vec3Tuple } from "../types.js";
import { BlueprintError } from "../errors.js";
import { formatBlockSpec } from "./blockSpec.js";
import { boxVolume, normalizeBox, splitBox } from "./box.js";
import { resolveBlock, type Blueprint } from "./schema.js";

const MAX_FILL_VOLUME = 32768;
const DEFAULT_MAX_COMMANDS = 2000;

const abs = (o: Vec3Tuple, p: Vec3Tuple): Vec3Tuple => [o[0] + p[0], o[1] + p[1], o[2] + p[2]];

export function compileBlueprint(bp: Blueprint, origin: Vec3Tuple, opts: { maxCommands?: number } = {}): string[] {
  const maxCommands = opts.maxCommands ?? DEFAULT_MAX_COMMANDS;
  const cmds: string[] = [];

  const tooMany = () => new BlueprintError(`コマンド数が上限 (${maxCommands}) を超えました。設計図を分割してください。`);
  const push = (c: string) => {
    if (cmds.length >= maxCommands) throw tooMany();
    cmds.push(c);
  };

  // Fills a box (already absolute, normalized), splitting it when over the volume limit.
  const fillBox = (min: Vec3Tuple, max: Vec3Tuple, block: string, suffix = "") => {
    // splitBox yields at least volume / limit pieces; fail before materializing them.
    if (Math.ceil(boxVolume(min, max) / MAX_FILL_VOLUME) > maxCommands - cmds.length) throw tooMany();
    for (const [a, b] of splitBox(min, max, MAX_FILL_VOLUME)) {
      push(`/fill ${a.join(" ")} ${b.join(" ")} ${block}${suffix}`);
    }
  };

  for (const op of bp.ops) {
    switch (op.op) {
      case "fill": {
        const block = formatBlockSpec(resolveBlock(bp, op.block));
        const [min, max] = normalizeBox(abs(origin, op.from), abs(origin, op.to));
        fillBox(min, max, block);
        break;
      }
      case "hollow": {
        const block = formatBlockSpec(resolveBlock(bp, op.block));
        const [min, max] = normalizeBox(abs(origin, op.from), abs(origin, op.to));
        if (boxVolume(min, max) <= MAX_FILL_VOLUME) {
          push(`/fill ${min.join(" ")} ${max.join(" ")} ${block} hollow`);
          break;
        }
        for (let axis = 0; axis < 3; axis++) {
          const sides = min[axis] === max[axis] ? [min[axis]] : [min[axis], max[axis]];
          for (const side of sides) {
            const fMin: Vec3Tuple = [...min];
            const fMax: Vec3Tuple = [...max];
            fMin[axis] = side;
            fMax[axis] = side;
            fillBox(fMin, fMax, block);
          }
        }
        const iMin: Vec3Tuple = [min[0] + 1, min[1] + 1, min[2] + 1];
        const iMax: Vec3Tuple = [max[0] - 1, max[1] - 1, max[2] - 1];
        if (iMin.every((v, i) => v <= iMax[i])) fillBox(iMin, iMax, "air");
        break;
      }
      case "set": {
        const block = formatBlockSpec(resolveBlock(bp, op.block));
        push(`/setblock ${abs(origin, op.at).join(" ")} ${block}`);
        break;
      }
      case "layers": {
        const [ox, oy, oz] = abs(origin, op.at);
        op.rows.forEach((layer, y) =>
          layer.forEach((row, z) => {
            const chars = [...row];
            let x = 0;
            while (x < chars.length) {
              const ch = chars[x];
              if (!Object.hasOwn(bp.palette, ch)) {
                x++;
                continue;
              }
              let end = x;
              while (end + 1 < chars.length && chars[end + 1] === ch) end++;
              const block = formatBlockSpec(resolveBlock(bp, ch));
              if (end > x) push(`/fill ${ox + x} ${oy + y} ${oz + z} ${ox + end} ${oy + y} ${oz + z} ${block}`);
              else push(`/setblock ${ox + x} ${oy + y} ${oz + z} ${block}`);
              x = end + 1;
            }
          }),
        );
        break;
      }
      case "we": {
        if (op.pos) push(`/tp @s ${abs(origin, op.pos).join(" ")}`);
        if (op.pos1) push(`//pos1 ${abs(origin, op.pos1).join(",")}`);
        if (op.pos2) push(`//pos2 ${abs(origin, op.pos2).join(",")}`);
        push(op.command);
        break;
      }
    }
  }
  return cmds;
}
