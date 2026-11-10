import { BlueprintError } from "../errors.js";
import type { BlockSpec } from "../types.js";

const SPEC_RE = /^([a-z0-9_:./-]+?)(?:\[(.*)\])?$/;

export function parseBlockSpec(s: string): BlockSpec {
  const m = SPEC_RE.exec(s.trim().toLowerCase());
  if (!m) throw new BlueprintError(`ブロック指定が不正です: ${s}`);
  const name = m[1].replace(/^minecraft:/, "");
  if (name === "") throw new BlueprintError(`ブロック指定が不正です: ${s}`);
  const state: Record<string, string> = {};
  if (m[2] !== undefined && m[2].trim() !== "") {
    for (const pair of m[2].split(",")) {
      const [k, v, ...rest] = pair.split("=").map((x) => x.trim());
      if (!k || !v || rest.length > 0) throw new BlueprintError(`ブロック状態が不正です: ${s}`);
      state[k] = v;
    }
  }
  return { name, state };
}

export function formatBlockSpec(b: BlockSpec): string {
  const entries = Object.entries(b.state);
  if (entries.length === 0) return b.name;
  return `${b.name}[${entries.map(([k, v]) => `${k}=${v}`).join(",")}]`;
}

export function blockMatches(expected: BlockSpec, actual: BlockSpec): boolean {
  if (expected.name !== actual.name) return false;
  return Object.entries(expected.state).every(([k, v]) => actual.state[k] === v);
}
