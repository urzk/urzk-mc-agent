import { describe, expect, test } from "vitest";
import { runScript } from "../../src/sandbox/runScript.js";

describe("runScript", () => {
  test("returns value and logs", async () =>
    expect(await runScript("log('hi', 1); return 1 + 1", {}, 1000)).toEqual({ result: 2, logs: ["hi 1"] }));
  test("exposes globals", async () => expect((await runScript("return x * 2", { x: 21 }, 1000)).result).toBe(42));
  test("no require/process", async () =>
    expect((await runScript("return [typeof require, typeof process]", {}, 1000)).result).toEqual(["undefined", "undefined"]));
  test("async timeout", async () =>
    expect((await runScript("await new Promise(() => {})", {}, 100)).error).toMatch(/Timed out/));
  test("sync timeout", async () =>
    expect((await runScript("while (true) {}", {}, 100)).error).toMatch(/Timed out|timed out/));
  test("error captured", async () => expect((await runScript("throw new Error('x')", {}, 1000)).error).toBe("x"));
  test("sleep works", async () => expect((await runScript("await sleep(10); return 'ok'", {}, 1000)).result).toBe("ok"));
  test("non-JSON result falls back to String", async () =>
    expect((await runScript("const a = {}; a.a = a; return a", {}, 1000)).result).toBe("[object Object]"));
});
