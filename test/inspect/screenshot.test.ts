import { describe, expect, test } from "vitest";
import { UserFacingError } from "../../src/errors.js";
import { screenshotUnavailable, serialized, translate, viewerVersionFor, waitForStableFrame } from "../../src/inspect/screenshot.js";

describe("screenshotUnavailable", () => {
  test("chrome missing suggests installing chrome", () => {
    for (const msg of ["Could not find Chrome (ver. 1.2)", "Browser was not found at the configured executablePath"]) {
      const e = screenshotUnavailable(new Error(msg));
      expect(e).toBeInstanceOf(UserFacingError);
      expect(e.message).toBe(
        `screenshot unavailable: ${msg}. Run \`pnpm exec puppeteer browsers install chrome\` once, then retry.`,
      );
    }
  });
  test("missing module names the module", () => {
    const e = screenshotUnavailable(new Error("Cannot find module 'express'\nRequire stack:"));
    expect(e.message).toContain("`pnpm rebuild express`");
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

describe("waitForStableFrame", () => {
  const fast = { minMs: 0, intervalMs: 1, maxMs: 200 };
  test("returns once two consecutive frames are identical", async () => {
    const frames = [[1], [2], [3], [3], [4]].map((f) => Uint8Array.from(f));
    let i = 0;
    const out = await waitForStableFrame(async () => frames[i++], fast);
    expect([...out]).toEqual([3]);
    expect(i).toBe(4);
  });
  test("gives up after maxMs with the latest frame", async () => {
    let n = 0;
    const out = await waitForStableFrame(async () => Uint8Array.from([n++ % 256]), { minMs: 0, intervalMs: 5, maxMs: 30 });
    expect(out[0]).toBe(n - 1);
  });
});

describe("viewerVersionFor", () => {
  const supported = ["1.21.1", "1.21.4"];
  const get = (v: string) => (v.startsWith("1.21") ? "1.21.4" : null);
  test("uses the viewer's mapping, falling back to the newest", () => {
    expect(viewerVersionFor("1.21.8", get, supported)).toBe("1.21.4");
    expect(viewerVersionFor("1.22", get, supported)).toBe("1.21.4");
  });
});

describe("translate", () => {
  const remap = (id: number) => id + 100;
  test("remaps block updates and leaves other events alone", () => {
    expect(translate("blockUpdate", { pos: 1, stateId: 5 }, remap)).toEqual({ pos: 1, stateId: 105 });
    const e = { id: 1 };
    expect(translate("entity", e, remap)).toBe(e);
    expect(translate("blockUpdate", e, null)).toBe(e);
  });
});
