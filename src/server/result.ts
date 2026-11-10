import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { UserFacingError } from "../errors.js";

export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

export function jsonResult(value: unknown): CallToolResult {
  return textResult(JSON.stringify(value));
}

/** Converts any thrown error into an `isError` tool result so the server process never crashes. */
export function safe<A>(handler: (args: A) => Promise<CallToolResult>): (args: A) => Promise<CallToolResult> {
  return async (args) => {
    try {
      return await handler(args);
    } catch (e) {
      const message =
        e instanceof UserFacingError ? e.message : `Internal error: ${e instanceof Error ? e.message : String(e)}`;
      if (!(e instanceof UserFacingError)) console.error(e);
      return { content: [{ type: "text", text: message }], isError: true };
    }
  };
}
