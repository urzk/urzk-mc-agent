import { join } from "node:path";
import { fileURLToPath } from "node:url";

// This module sits one level below the package root in both src/ (tsx, vitest) and dist/ (built).
export const packageRoot = fileURLToPath(new URL("../", import.meta.url));
export const envFilePath = join(packageRoot, ".env");
export const msaCacheDir = join(packageRoot, ".cache", "msa");
