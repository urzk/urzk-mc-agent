import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { BlueprintError } from "../errors.js";
import { BlueprintSchema, type Blueprint } from "./schema.js";

/**
 * Resolves the blueprint given either inline or as a path to a JSON file. A file keeps large generated
 * blueprints out of the tool call (pasting tens of KB of JSON costs as many tokens).
 */
export async function loadBlueprint(input: { blueprint?: Blueprint; blueprintPath?: string }): Promise<Blueprint> {
  const { blueprint, blueprintPath } = input;
  if (blueprint && blueprintPath) throw new BlueprintError("blueprint と blueprintPath はどちらか一方だけ指定してください。");
  if (blueprint) return blueprint;
  if (!blueprintPath) throw new BlueprintError("blueprint か blueprintPath のどちらかを指定してください。");
  if (!isAbsolute(blueprintPath)) throw new BlueprintError(`blueprintPath は絶対パスで指定してください: ${blueprintPath}`);

  let text: string;
  try {
    text = await readFile(blueprintPath, "utf8");
  } catch (e) {
    throw new BlueprintError(`設計図ファイルを読めません: ${blueprintPath} (${e instanceof Error ? e.message : String(e)})`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new BlueprintError(`設計図ファイルが JSON ではありません: ${blueprintPath} (${e instanceof Error ? e.message : String(e)})`);
  }
  const parsed = BlueprintSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new BlueprintError(`設計図ファイルの形式が不正です: ${blueprintPath} (${issues})`);
  }
  return parsed.data;
}
