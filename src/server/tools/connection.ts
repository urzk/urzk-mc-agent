import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../createServer.js";
import { jsonResult, safe } from "../result.js";

export function registerConnectionTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "connect",
    {
      description:
        "Connect the bot to a Minecraft server. Omitted arguments fall back to the MC_* settings. " +
        "With auth=microsoft the first login returns a device code (verificationUri + userCode): " +
        "tell the user to open the URL and enter the code, then poll get_status until connected.",
      inputSchema: {
        host: z.string().optional(),
        port: z.number().int().min(1).max(65535).optional(),
        username: z.string().optional(),
        auth: z.enum(["offline", "microsoft"]).optional(),
        version: z.string().optional().describe('Minecraft version, e.g. "1.21.1"; auto-detected if omitted'),
      },
    },
    safe(async (args) => jsonResult(await ctx.bots.connect(args))),
  );

  server.registerTool(
    "disconnect",
    { description: "Disconnect the bot from the server.", inputSchema: {} },
    safe(async () => {
      ctx.bots.disconnect();
      return jsonResult({ connected: false });
    }),
  );

  server.registerTool(
    "get_status",
    {
      description:
        "Get connection state, position, yaw/pitch, game mode, health, held item and nearby players. " +
        "Works while disconnected (returns connected=false and the last disconnect reason).",
      inputSchema: {},
    },
    safe(async () => jsonResult(ctx.bots.status())),
  );
}
