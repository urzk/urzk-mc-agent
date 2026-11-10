import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NotLoadedError } from "../../errors.js";
import { assertReadableRange } from "../../inspect/range.js";
import { listBlocks, renderLayers } from "../../inspect/layers.js";
import { makeBlockReader } from "../../inspect/blockReader.js";
import { formatBlockSpec } from "../../blueprint/blockSpec.js";
import type { ToolContext } from "../createServer.js";
import { jsonResult, safe } from "../result.js";

const Coord = z.tuple([z.number().int(), z.number().int(), z.number().int()]);

export function registerInspectTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "read_blocks",
    {
      description:
        "Read blocks in a box (max 32x32x32). format=list returns non-air blocks with positions plus airCount; " +
        "format=layers returns per-Y-layer text maps (north=-z at top, west=-x at left) with a legend ('.' is air). " +
        "Fails if any chunk in the range is not loaded.",
      inputSchema: { from: Coord, to: Coord, format: z.enum(["list", "layers"]) },
    },
    safe(async ({ from, to, format }) => {
      const [min, max] = assertReadableRange(from, to);
      const read = makeBlockReader(ctx.bots.bot);
      return jsonResult(format === "list" ? listBlocks(min, max, read) : renderLayers(min, max, read));
    }),
  );

  server.registerTool(
    "get_block",
    {
      description: "Get the block name and state at one position. Fails if the chunk is not loaded.",
      inputSchema: { x: z.number().int(), y: z.number().int(), z: z.number().int() },
    },
    safe(async ({ x, y, z: zc }) => {
      const b = makeBlockReader(ctx.bots.bot)([x, y, zc]);
      if (b === null) throw new NotLoadedError([x, y, zc]);
      return jsonResult({ name: b.name, state: b.state, text: formatBlockSpec(b) });
    }),
  );

  server.registerTool(
    "wait_ticks",
    {
      description: "Wait n game ticks (20 ticks = 1 second), e.g. for redstone to settle before get_block.",
      inputSchema: { n: z.number().int().min(1).max(12000) },
    },
    safe(async ({ n }) => {
      await ctx.bots.bot.waitForTicks(n);
      return jsonResult({ waited: n });
    }),
  );
}
