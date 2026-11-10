import { expect, test } from "vitest";
import { NotLoadedError } from "../src/errors.js";

test("NotLoadedError tells how to recover", () => {
  const m = new NotLoadedError([1, 2, 3]).message;
  expect(m).toContain("1,2,3");
  expect(m).toContain("teleport");
});
