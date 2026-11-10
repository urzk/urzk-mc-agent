import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Vec3 } from "vec3";
import { z } from "zod";
import { makeBlockReader } from "../../inspect/blockReader.js";
import { runScript } from "../../sandbox/runScript.js";
import type { ToolContext } from "../createServer.js";
import { jsonResult, safe } from "../result.js";

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 120000;

export function registerScriptTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "run_script",
    {
      description:
        "Run JavaScript (the body of an async function) with `bot`, `Vec3`, `readBlock([x,y,z])`, `log(...)` and `sleep(ms)` available. Use `return` to give a result. Default timeout 30000ms, max 120000ms. The timeout cannot interrupt a busy synchronous loop that runs after an await, and such a loop hangs the whole server, so never busy-wait: use `await sleep(ms)` in polling loops. After a timeout the script may keep running in the background. Not a secure sandbox: local use only.",
      inputSchema: { code: z.string().min(1), timeoutMs: z.number().int().min(1).default(DEFAULT_TIMEOUT_MS) },
    },
    safe(async ({ code, timeoutMs }) => {
      const bot = ctx.bots.bot;
      const outcome = await runScript(
        code,
        { bot, Vec3, readBlock: makeBlockReader(bot) },
        Math.min(timeoutMs, MAX_TIMEOUT_MS),
      );
      return { ...jsonResult(outcome), ...(outcome.error ? { isError: true } : {}) };
    }),
  );
}
