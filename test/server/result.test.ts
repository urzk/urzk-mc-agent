import { describe, expect, test } from "vitest";
import { UserFacingError } from "../../src/errors.js";
import { jsonResult, safe, textResult } from "../../src/server/result.js";

describe("result helpers", () => {
  test("jsonResult wraps a single JSON text content", () => {
    expect(jsonResult({ a: 1 })).toEqual({ content: [{ type: "text", text: JSON.stringify({ a: 1 }) }] });
  });
  test("textResult wraps text", () => {
    expect(textResult("hi")).toEqual({ content: [{ type: "text", text: "hi" }] });
  });
  test("safe passes through results", async () => {
    expect(await safe(async () => textResult("ok"))({})).toEqual(textResult("ok"));
  });
  test("safe hides internals for unknown errors", async () => {
    const r = await safe(async () => {
      throw new Error("boom");
    })({});
    expect(r).toEqual({ content: [{ type: "text", text: "Internal error: boom" }], isError: true });
  });
  test("safe returns only the message for UserFacingError", async () => {
    const r = await safe(async () => {
      throw new UserFacingError("bad input");
    })({});
    expect(r).toEqual({ content: [{ type: "text", text: "bad input" }], isError: true });
  });
});
