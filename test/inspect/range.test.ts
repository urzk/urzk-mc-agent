import { describe, expect, test } from "vitest";
import { assertReadableRange } from "../../src/inspect/range.js";
import { UserFacingError } from "../../src/errors.js";

describe("range", () => {
  test("too big", () => expect(() => assertReadableRange([0, 0, 0], [40, 40, 40])).toThrow(UserFacingError));
  test("exactly max ok", () => expect(() => assertReadableRange([0, 0, 0], [31, 31, 31])).not.toThrow());
  test("normalized", () => expect(assertReadableRange([3, 3, 3], [0, 0, 0])).toEqual([[0, 0, 0], [3, 3, 3]]));
});
