import { z } from "zod";
import type { BlockSpec } from "../types.js";
import { parseBlockSpec } from "./blockSpec.js";

const Coord = z
  .tuple([z.number().int(), z.number().int(), z.number().int()])
  .describe("相対座標 [x, y, z]（整数）");

const Block = z.string().describe("ブロック指定。palette のキー（1文字）または 'oak_planks' / 'oak_stairs[facing=east]' など");

export const BlueprintSchema = z.object({
  palette: z
    .record(z.string().length(1), z.string())
    .default({})
    .describe("1文字キー → ブロック指定 の対応表（layers や block で参照）"),
  ops: z
    .array(
      z.discriminatedUnion("op", [
        z.object({ op: z.literal("fill"), from: Coord, to: Coord, block: Block }).describe("直方体を block で埋める"),
        z.object({ op: z.literal("hollow"), from: Coord, to: Coord, block: Block }).describe("外殻だけ block、内部は air"),
        z.object({ op: z.literal("set"), at: Coord, block: Block }).describe("1ブロック設置"),
        z
          .object({
            op: z.literal("layers"),
            at: Coord,
            rows: z.array(z.array(z.string())).describe("rows[y][z] の文字列。rows[0] が最下層（at.y）で y は上方向に増える。z は南 (+z) 方向、文字 index が x（東 (+x) 方向）。palette にない文字は無変更"),
          })
          .describe("文字パターンによる層ごとの配置"),
        z
          .object({
            op: z.literal("we"),
            command: z.string(),
            pos: Coord.optional(),
            pos1: Coord.optional(),
            pos2: Coord.optional(),
          })
          .describe("WorldEdit コマンド（展開対象外）"),
      ]),
    )
    .describe("順番に適用される操作。後の op が先の op を上書きする"),
});

export type Blueprint = z.infer<typeof BlueprintSchema>;

export function resolveBlock(bp: Blueprint, ref: string): BlockSpec {
  return parseBlockSpec(Object.hasOwn(bp.palette, ref) ? bp.palette[ref] : ref);
}
