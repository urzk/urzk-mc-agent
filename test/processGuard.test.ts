import { afterEach, expect, test, vi } from "vitest";
import { installProcessGuards } from "../src/processGuard.js";

afterEach(() => vi.restoreAllMocks());

test("installs handlers that log instead of crashing", () => {
  const on = vi.spyOn(process, "on").mockImplementation(() => process);
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  installProcessGuards();
  const handlers = Object.fromEntries(on.mock.calls.map(([ev, fn]) => [ev, fn as (e: unknown) => void]));
  expect(Object.keys(handlers)).toEqual(expect.arrayContaining(["unhandledRejection", "uncaughtException"]));
  handlers.unhandledRejection(new Error("boom"));
  handlers.uncaughtException(new Error("bang"));
  expect(err).toHaveBeenCalledTimes(2);
});
