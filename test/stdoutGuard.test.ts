import { afterAll, expect, test, vi } from "vitest";

const original = { log: console.log, info: console.info, debug: console.debug };
afterAll(() => Object.assign(console, original));

test("console.log/info/debug are redirected to console.error", async () => {
  await import("../src/stdoutGuard.js");
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  console.log("a");
  console.info("b");
  console.debug("c");
  expect(spy.mock.calls).toEqual([["a"], ["b"], ["c"]]);
  spy.mockRestore();
});
