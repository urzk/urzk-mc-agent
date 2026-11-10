import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { msaCacheDir, packageRoot } from "../src/paths.js";

test("packageRoot is the directory holding package.json, independent of cwd", () => {
  expect(existsSync(join(packageRoot, "package.json"))).toBe(true);
});
test("msaCacheDir lives under the package root", () => {
  expect(msaCacheDir).toBe(join(packageRoot, ".cache", "msa"));
});
