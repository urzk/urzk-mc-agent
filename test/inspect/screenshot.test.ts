import { describe, expect, test } from "vitest";
import { UserFacingError } from "../../src/errors.js";
import { screenshotUnavailable, serialized } from "../../src/inspect/screenshot.js";

describe("screenshotUnavailable", () => {
  test("chrome missing suggests installing chrome", () => {
    for (const msg of ["Could not find Chrome (ver. 1.2)", "Browser was not found at the configured executablePath"]) {
      const e = screenshotUnavailable(new Error(msg));
      expect(e).toBeInstanceOf(UserFacingError);
      expect(e.message).toBe(
        `screenshot unavailable: ${msg}. Run \`npx puppeteer browsers install chrome\` once, then retry.`,
      );
    }
  });
  test("missing module names the module", () => {
    const e = screenshotUnavailable(new Error("Cannot find module 'express'\nRequire stack:"));
    expect(e.message).toContain("`npm rebuild express`");
    expect(e.message).not.toContain("puppeteer browsers install");
  });
  test("other errors give the reason only", () => {
    const e = screenshotUnavailable(new Error("Timed out after 30000 ms"));
    expect(e.message).toBe("screenshot unavailable: Timed out after 30000 ms.");
    expect(screenshotUnavailable("boom").message).toBe("screenshot unavailable: boom.");
  });
});

describe("serialized", () => {
  test("runs jobs one at a time in order and survives failures", async () => {
    const log: string[] = [];
    const job = (name: string, ms: number, fail = false) => () =>
      new Promise<string>((resolve, reject) => {
        log.push(`start ${name}`);
        setTimeout(() => {
          log.push(`end ${name}`);
          fail ? reject(new Error(name)) : resolve(name);
        }, ms);
      });
    const a = serialized(job("a", 20, true));
    const b = serialized(job("b", 5));
    const c = serialized(job("c", 1));
    await expect(a).rejects.toThrow("a");
    expect(await b).toBe("b");
    expect(await c).toBe("c");
    expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  });
});
