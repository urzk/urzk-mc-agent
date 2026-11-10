import { describe, expect, test } from "vitest";
import { UserFacingError } from "../../src/errors.js";
import { screenshotUnavailable } from "../../src/inspect/screenshot.js";

describe("screenshotUnavailable", () => {
  test("wraps the cause in a UserFacingError with the install hint", () => {
    const e = screenshotUnavailable(new Error("Could not find Chrome"));
    expect(e).toBeInstanceOf(UserFacingError);
    expect(e.message).toBe(
      "screenshot unavailable: Could not find Chrome. Run `npx puppeteer browsers install chrome` once, then retry.",
    );
  });
  test("handles non-Error causes", () => {
    expect(screenshotUnavailable("boom").message).toContain("screenshot unavailable: boom.");
  });
});
