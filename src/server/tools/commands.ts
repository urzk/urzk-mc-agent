import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runCommand, runCommands } from "../../commands/collector.js";
import type { ToolContext } from "../createServer.js";
import { jsonResult, safe } from "../result.js";

export function registerCommandTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "run_command",
    {
      description:
        "Send one chat command (e.g. /time set day, //pos1 ...) and return the chat messages received during collectMs (default 1000). " +
        "A leading / is added if missing. Failures such as missing permission appear in the returned messages.",
      inputSchema: {
        command: z.string().min(1),
        collectMs: z.number().int().min(0).max(30000).optional(),
      },
    },
    safe(async ({ command, collectMs }) => jsonResult(await runCommand(ctx.bots.bot, command, collectMs))),
  );

  server.registerTool(
    "run_commands",
    {
      description:
        "Send several chat commands in order, waiting delayMs between them (default 50, avoids spam kicks), " +
        "then collect chat responses for collectMs (default 1000).",
      inputSchema: {
        commands: z.array(z.string().min(1)).min(1),
        delayMs: z.number().int().min(0).max(10000).optional(),
        collectMs: z.number().int().min(0).max(30000).optional(),
      },
    },
    safe(async ({ commands, delayMs, collectMs }) =>
      jsonResult(await runCommands(ctx.bots.bot, commands, { delayMs, collectMs })),
    ),
  );
}
