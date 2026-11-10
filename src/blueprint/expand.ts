import { posKey, type BlockSpec } from "../types.js";
import { normalizeBox } from "./box.js";
import { resolveBlock, type Blueprint } from "./schema.js";

export function expandBlueprint(bp: Blueprint): { voxels: Map<string, BlockSpec>; skippedOps: number[] } {
  const voxels = new Map<string, BlockSpec>();
  const skippedOps: number[] = [];
  const AIR: BlockSpec = { name: "air", state: {} };

  bp.ops.forEach((op, i) => {
    switch (op.op) {
      case "fill":
      case "hollow": {
        const block = resolveBlock(bp, op.block);
        const [min, max] = normalizeBox(op.from, op.to);
        for (let x = min[0]; x <= max[0]; x++)
          for (let y = min[1]; y <= max[1]; y++)
            for (let z = min[2]; z <= max[2]; z++) {
              const shell =
                op.op === "fill" ||
                x === min[0] || x === max[0] || y === min[1] || y === max[1] || z === min[2] || z === max[2];
              voxels.set(posKey([x, y, z]), shell ? block : { ...AIR });
            }
        break;
      }
      case "set":
        voxels.set(posKey(op.at), resolveBlock(bp, op.block));
        break;
      case "layers": {
        const [ox, oy, oz] = op.at;
        op.rows.forEach((layer, y) =>
          layer.forEach((row, z) => {
            [...row].forEach((ch, x) => {
              if (!Object.hasOwn(bp.palette, ch)) return;
              voxels.set(posKey([ox + x, oy + y, oz + z]), resolveBlock(bp, ch));
            });
          }),
        );
        break;
      }
      case "we":
        skippedOps.push(i);
        break;
    }
  });
  return { voxels, skippedOps };
}
