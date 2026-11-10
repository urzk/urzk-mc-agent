# Minecraft 建築エージェント Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code から MCP 経由で Mineflayer Bot を操作し、Minecraft（クリエイティブ）で建築・照合・動作確認ができる MCP サーバーを作る。

**Architecture:** stdio の MCP サーバー（TypeScript/ESM）が 1 体の Mineflayer Bot を管理する。設計図ロジック（`src/blueprint/`）とレイヤー描画は Minecraft 非依存の純粋関数で単体テストし、Bot に触る部分は薄いツールハンドラと注入可能な依存（`ChatBot`、`readBlock` 関数など）で分離する。

**Tech Stack:** Node.js 22+, TypeScript 5, `@modelcontextprotocol/sdk`, `zod`, `mineflayer`, `mineflayer-pathfinder`, `vec3`, `prismarine-item`, `prismarine-viewer` + `puppeteer`（スクリーンショット）, `vitest`, `tsx`（スクリプト実行）

**Spec:** `docs/superpowers/specs/2026-11-10-mc-build-agent-design.md`

## Global Constraints

- Node.js >= 22、`package.json` は `"type": "module"`、TypeScript は `module`/`moduleResolution` = `NodeNext`（相対 import は `.js` 拡張子付き）。
- stdout は MCP 専用。ログはすべて `console.error`（stderr）。
- サーバー固有 API に依存しない。サーバー操作はチャットコマンド（`/`・`//`）とプロトコルのみ。
- 認証は `offline` と `microsoft` の両対応。設定のデフォルトは `.env` の `MC_HOST`, `MC_PORT`, `MC_USERNAME`, `MC_AUTH`, `MC_VERSION`、`connect` 引数で上書き。
- コマンド応答収集の既定 `collectMs` = 1000ms。`run_commands` の既定 `delayMs` = 50ms。
- `/fill` 1 回の上限体積 = 32768。`apply_blueprint` のコマンド数上限既定 = 2000。
- `read_blocks` の範囲上限 = 32×32×32（体積 32768）。
- 照合差分は先頭 50 件まで、残りは件数のみ。
- `run_script` タイムアウト既定 30000ms、最大 120000ms。`MC_AGENT_ENABLE_SCRIPT=false` のときツールを登録しない（既定 true）。
- ツール内の例外はすべて `isError: true` の結果として返し、プロセスを落とさない。
- 座標タプル型は `Vec3Tuple = [number, number, number]`、座標キー文字列は `"x,y,z"`。

## Review Focus

1. 設計図の `from`/`to` が逆順（from > to）で書かれる → min/max に正規化して同じ結果になるべき。Task 3・Task 4 にテスト追加。
2. palette やブロック名に `minecraft:` 接頭辞や大文字が混ざる → 正規化され、照合で一致扱いになるべき。Task 2・Task 5 にテスト追加。
3. `origin` が負の座標（例: `[-100, 64, -200]`）→ 絶対座標が正しく計算され、分割も正しいべき。Task 4 にテスト追加。
4. 実ワールドの状態値が boolean/number（`powered: true`）で、設計図側は文字列（`"true"`）→ 一致扱いになるべき。Task 9（`makeBlockReader` の文字列化）と Task 2（`blockMatches`）にテスト追加。
5. `run_command` に先頭 `/` なしで渡される（`fill ...`）→ `/` を補って送るべき。`//` で始まるものはそのまま。Task 7 にテスト追加。

---

## File Structure

```
package.json, tsconfig.json, vitest.config.ts, .env.example, .gitignore, .mcp.json, README.md
src/
  index.ts                 # エントリ: loadEnv → createServer → stdio 接続
  config.ts                # loadConfig(env)
  types.ts                 # Vec3Tuple, BlockSpec, posKey, parsePosKey
  errors.ts                # NotConnectedError, NotLoadedError, BlueprintError, UserFacingError
  blueprint/
    blockSpec.ts           # parseBlockSpec, formatBlockSpec, blockMatches
    schema.ts              # BlueprintSchema (zod), Blueprint 型, resolveBlock
    box.ts                 # normalizeBox, boxVolume, splitBox
    expand.ts              # expandBlueprint
    compile.ts             # compileBlueprint
    verify.ts              # verifyBlueprint
    apply.ts               # applyBlueprint (依存注入のオーケストレーション)
  inspect/
    layers.ts              # renderLayers
    range.ts               # assertReadableRange
    blockReader.ts         # makeBlockReader(bot)
    screenshot.ts          # takeScreenshot(bot, ...)
  commands/
    collector.ts           # ChatBot 型, normalizeCommand, runCommand, runCommands
  bot/
    manager.ts             # BotManager
    placement.ts           # chooseReferenceFace
  sandbox/
    runScript.ts           # runScript
  server/
    createServer.ts        # McpServer 生成、instructions、全ツール登録
    result.ts              # jsonResult, textResult, safe()
    tools/
      connection.ts        # connect, disconnect, get_status
      commands.ts          # run_command, run_commands
      movement.ts          # move_to, teleport, look_at, interact_block, place_block, dig_block
      inventory.ts         # get_inventory, set_hotbar_slot, give_item, equip, drop, open_container, container_transfer
      inspect.ts           # read_blocks, get_block, wait_ticks, screenshot
      blueprint.ts         # apply_blueprint, verify_blueprint
      script.ts            # run_script
test/                      # src と同じ構成で *.test.ts
scripts/smoke.ts           # 実サーバーでの結合確認
```

---

### Task 1: プロジェクト土台と設定読み込み

**Files:**
- Modify: `package.json`
- Create: `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `src/config.ts`, `src/types.ts`, `src/errors.ts`
- Test: `test/config.test.ts`, `test/types.test.ts`

**Interfaces:**
- Produces:
  - `type Vec3Tuple = [number, number, number]`
  - `type BlockSpec = { name: string; state: Record<string, string> }`
  - `posKey(p: Vec3Tuple): string` → `"x,y,z"`、`parsePosKey(k: string): Vec3Tuple`
  - `class UserFacingError extends Error`、`NotConnectedError`, `NotLoadedError(pos: Vec3Tuple)`, `BlueprintError` はすべて `UserFacingError` のサブクラス
  - `type AppConfig = { host: string; port: number; username: string; auth: "offline" | "microsoft"; version: string | undefined; enableScript: boolean }`
  - `loadConfig(env: Record<string, string | undefined>): AppConfig`

- [ ] **Step 1: 土台を作る**

`npm i @modelcontextprotocol/sdk zod mineflayer mineflayer-pathfinder vec3 prismarine-item prismarine-viewer puppeteer` と `npm i -D typescript @types/node vitest tsx`。`package.json` に `"engines": {"node": ">=22"}`、scripts: `"build": "tsc"`, `"start": "node dist/index.js"`, `"test": "vitest run"`, `"smoke": "tsx scripts/smoke.ts"`。`tsconfig.json`: `target ES2022`, `module/moduleResolution NodeNext`, `strict`, `outDir dist`, `rootDir src`, `include ["src"]`。`.gitignore`: `node_modules dist .env .cache`。`.env.example` に 5 つの `MC_*` と `MC_AGENT_ENABLE_SCRIPT=true`。

- [ ] **Step 2: 失敗するテストを書く**

```ts
// test/config.test.ts
test("defaults", () => {
  expect(loadConfig({})).toEqual({ host: "localhost", port: 25565, username: "ClaudeBuilder",
    auth: "offline", version: undefined, enableScript: true });
});
test("reads env", () => {
  const c = loadConfig({ MC_HOST: "mc.local", MC_PORT: "25566", MC_USERNAME: "Bob",
    MC_AUTH: "microsoft", MC_VERSION: "1.21.4", MC_AGENT_ENABLE_SCRIPT: "false" });
  expect(c).toEqual({ host: "mc.local", port: 25566, username: "Bob", auth: "microsoft",
    version: "1.21.4", enableScript: false });
});
test("rejects bad auth", () => { expect(() => loadConfig({ MC_AUTH: "xbox" })).toThrow(/MC_AUTH/); });
// test/types.test.ts
test("posKey roundtrip", () => { expect(parsePosKey(posKey([-3, 64, 10]))).toEqual([-3, 64, 10]); });
```

- [ ] **Step 3: 失敗を確認** — Run: `npx vitest run test/config.test.ts test/types.test.ts` / Expected: FAIL（モジュールが見つからない）

- [ ] **Step 4: `src/config.ts`, `src/types.ts`, `src/errors.ts` を実装**

- [ ] **Step 5: 通過を確認** — Run: `npx vitest run && npx tsc --noEmit` / Expected: PASS、型エラーなし

- [ ] **Step 6: Commit** — `git add -A && git commit -m "chore: プロジェクト土台と設定読み込み"`

---

### Task 2: ブロック指定のパースと比較

**Files:**
- Create: `src/blueprint/blockSpec.ts`
- Test: `test/blueprint/blockSpec.test.ts`

**Interfaces:**
- Consumes: `BlockSpec`（Task 1）
- Produces:
  - `parseBlockSpec(s: string): BlockSpec` — `minecraft:` を除去、名前とキーを小文字化、`[k=v,...]` を state に
  - `formatBlockSpec(b: BlockSpec): string` — `name` または `name[k=v,...]`（state の挿入順）
  - `blockMatches(expected: BlockSpec, actual: BlockSpec): boolean` — 名前一致、かつ expected の state キーだけ比較

- [ ] **Step 1: 失敗するテストを書く**

```ts
test("parse plain", () => expect(parseBlockSpec("stone")).toEqual({ name: "stone", state: {} }));
test("parse with state", () => expect(parseBlockSpec("oak_door[facing=south,half=lower]"))
  .toEqual({ name: "oak_door", state: { facing: "south", half: "lower" } }));
test("normalizes prefix and case", () =>
  expect(parseBlockSpec("Minecraft:Stone_Bricks")).toEqual({ name: "stone_bricks", state: {} }));
test("rejects malformed", () => expect(() => parseBlockSpec("oak_door[facing]")).toThrow(BlueprintError));
test("format", () => expect(formatBlockSpec({ name: "lever", state: { powered: "true" } })).toBe("lever[powered=true]"));
test("matches partial state", () => expect(blockMatches(
  { name: "lever", state: { powered: "true" } },
  { name: "lever", state: { powered: "true", face: "wall", facing: "north" } })).toBe(true));
test("mismatch state", () => expect(blockMatches(
  { name: "lever", state: { powered: "true" } }, { name: "lever", state: { powered: "false" } })).toBe(false));
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run test/blueprint/blockSpec.test.ts` / Expected: FAIL

- [ ] **Step 3: 実装**

- [ ] **Step 4: 通過を確認** — 同コマンド / Expected: PASS

- [ ] **Step 5: Commit** — `git commit -m "feat: ブロック指定のパースと比較"`

---

### Task 3: 設計図スキーマ・箱ユーティリティ・展開

**Files:**
- Create: `src/blueprint/schema.ts`, `src/blueprint/box.ts`, `src/blueprint/expand.ts`
- Test: `test/blueprint/schema.test.ts`, `test/blueprint/box.test.ts`, `test/blueprint/expand.test.ts`

**Interfaces:**
- Consumes: `parseBlockSpec`, `BlockSpec`, `Vec3Tuple`, `posKey`, `BlueprintError`
- Produces:
  - `BlueprintSchema`（zod）と `type Blueprint = z.infer<typeof BlueprintSchema>`。op は判別共用体 `op`:
    - `{ op: "fill", from, to, block }` / `{ op: "hollow", from, to, block }` / `{ op: "set", at, block }`
    - `{ op: "layers", at, rows: string[][] }`（`rows[y][z]` の文字列、文字 index が x）
    - `{ op: "we", command: string, pos?: Vec3Tuple, pos1?: Vec3Tuple, pos2?: Vec3Tuple }`
    - `palette` は省略可（既定 `{}`）、キーは 1 文字
  - `resolveBlock(bp: Blueprint, ref: string): BlockSpec` — palette にあればその値をパース、なければ `ref` をパース
  - `normalizeBox(a: Vec3Tuple, b: Vec3Tuple): [Vec3Tuple, Vec3Tuple]`（min, max）
  - `boxVolume(min, max): number`
  - `splitBox(min, max, maxVolume: number): [Vec3Tuple, Vec3Tuple][]` — 体積が上限以下になるまで最長軸で半分に再帰分割
  - `expandBlueprint(bp: Blueprint): { voxels: Map<string, BlockSpec>; skippedOps: number[] }` — 相対座標。`hollow` は外殻を block、内部を `air`。`layers` で palette にない文字は無変更。`we` は index を `skippedOps` に入れる

- [ ] **Step 1: 失敗するテストを書く**

```ts
// schema
test("rejects unknown op", () => expect(BlueprintSchema.safeParse({ ops: [{ op: "boom" }] }).success).toBe(false));
test("palette default", () => expect(BlueprintSchema.parse({ ops: [] }).palette).toEqual({}));
test("resolveBlock palette then literal", () => {
  const bp = BlueprintSchema.parse({ palette: { S: "stone" }, ops: [] });
  expect(resolveBlock(bp, "S")).toEqual({ name: "stone", state: {} });
  expect(resolveBlock(bp, "glass")).toEqual({ name: "glass", state: {} });
});
// box
test("normalize reversed", () => expect(normalizeBox([5, 1, 9], [0, 3, 2])).toEqual([[0, 1, 2], [5, 3, 9]]));
test("split respects max", () => {
  const parts = splitBox([0, 0, 0], [99, 9, 99], 32768);   // 100000 blocks
  expect(parts.every(([a, b]) => boxVolume(a, b) <= 32768)).toBe(true);
  expect(parts.reduce((s, [a, b]) => s + boxVolume(a, b), 0)).toBe(100000);
});
// expand
test("later ops overwrite", () => {
  const bp = BlueprintSchema.parse({ ops: [
    { op: "fill", from: [0, 0, 0], to: [1, 0, 1], block: "stone" },
    { op: "set", at: [1, 0, 1], block: "glass" }] });
  const { voxels } = expandBlueprint(bp);
  expect(voxels.size).toBe(4);
  expect(voxels.get("1,0,1")).toEqual({ name: "glass", state: {} });
});
test("hollow interior is air", () => {
  const { voxels } = expandBlueprint(BlueprintSchema.parse({ ops: [{ op: "hollow", from: [0, 0, 0], to: [2, 2, 2], block: "stone" }] }));
  expect(voxels.get("1,1,1")!.name).toBe("air");
  expect(voxels.get("0,1,1")!.name).toBe("stone");
});
test("reversed fill same as forward", () => {
  const a = expandBlueprint(BlueprintSchema.parse({ ops: [{ op: "fill", from: [2, 0, 2], to: [0, 0, 0], block: "stone" }] }));
  expect(a.voxels.size).toBe(9);
});
test("layers: unknown char unchanged, x from char index", () => {
  const { voxels } = expandBlueprint(BlueprintSchema.parse({ palette: { S: "stone", ".": "air" },
    ops: [{ op: "layers", at: [10, 0, 0], rows: [["S.", " S"]] }] }));
  expect(voxels.get("10,0,0")!.name).toBe("stone");
  expect(voxels.get("11,0,0")!.name).toBe("air");
  expect(voxels.has("10,0,1")).toBe(false);
  expect(voxels.get("11,0,1")!.name).toBe("stone");
});
test("we op skipped", () => expect(expandBlueprint(BlueprintSchema.parse({ ops: [{ op: "we", command: "//sphere glass 3" }] })).skippedOps).toEqual([0]));
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run test/blueprint` / Expected: FAIL

- [ ] **Step 3: 3 ファイルを実装**

- [ ] **Step 4: 通過を確認** — 同コマンド / Expected: PASS

- [ ] **Step 5: Commit** — `git commit -m "feat: 設計図スキーマと展開"`

---

### Task 4: 設計図 → コマンド変換

**Files:**
- Create: `src/blueprint/compile.ts`
- Test: `test/blueprint/compile.test.ts`

**Interfaces:**
- Consumes: `Blueprint`, `resolveBlock`, `formatBlockSpec`, `normalizeBox`, `boxVolume`, `splitBox`, `BlueprintError`
- Produces: `compileBlueprint(bp: Blueprint, origin: Vec3Tuple, opts?: { maxCommands?: number }): string[]`（絶対座標、既定 `maxCommands` 2000、超過で `BlueprintError`）

変換規則:
- `fill` → `/fill x1 y1 z1 x2 y2 z2 <formatBlockSpec>`。体積 > 32768 なら `splitBox` の各片ごと。
- `hollow` → 体積 ≤ 32768 なら `/fill ... <block> hollow`。超えたら、6 面それぞれを `/fill`（各面も `splitBox`）＋内部（両端を 1 ずつ縮めた箱、空でなければ）を `air` で `/fill`（`splitBox`）。
- `set` → `/setblock x y z <block>`。
- `layers` → 各 (y, z) 行で、palette にある同じ文字が x 方向に連続する区間を、長さ 2 以上なら `/fill`、1 なら `/setblock`。
- `we` → `pos` があれば `/tp @s x y z`、`pos1` があれば `//pos1 x,y,z`、`pos2` があれば `//pos2 x,y,z`（すべて絶対座標）、最後に `command`。

- [ ] **Step 1: 失敗するテストを書く**

```ts
const P = (o: unknown) => BlueprintSchema.parse(o);
test("fill absolute with negative origin", () => expect(compileBlueprint(
  P({ ops: [{ op: "fill", from: [0, 0, 0], to: [2, 1, 2], block: "stone" }] }), [-100, 64, -200]))
  .toEqual(["/fill -100 64 -200 -98 65 -198 stone"]));
test("reversed from/to normalized", () => expect(compileBlueprint(
  P({ ops: [{ op: "fill", from: [2, 1, 2], to: [0, 0, 0], block: "stone" }] }), [0, 0, 0]))
  .toEqual(["/fill 0 0 0 2 1 2 stone"]));
test("large fill split", () => {
  const cmds = compileBlueprint(P({ ops: [{ op: "fill", from: [0, 0, 0], to: [99, 9, 99], block: "stone" }] }), [0, 0, 0]);
  expect(cmds.length).toBeGreaterThan(1);
  expect(cmds.every(c => c.startsWith("/fill "))).toBe(true);
});
test("hollow small", () => expect(compileBlueprint(
  P({ ops: [{ op: "hollow", from: [0, 0, 0], to: [4, 4, 4], block: "oak_planks" }] }), [0, 0, 0]))
  .toEqual(["/fill 0 0 0 4 4 4 oak_planks hollow"]));
test("set with state via palette", () => expect(compileBlueprint(
  P({ palette: { D: "oak_door[facing=south,half=lower]" }, ops: [{ op: "set", at: [1, 2, 3], block: "D" }] }), [10, 0, 0]))
  .toEqual(["/setblock 11 2 3 oak_door[facing=south,half=lower]"]));
test("layers merges runs", () => expect(compileBlueprint(
  P({ palette: { S: "stone", G: "glass" }, ops: [{ op: "layers", at: [0, 0, 0], rows: [["SSG S"]] }] }), [0, 0, 0]))
  .toEqual(["/fill 0 0 0 1 0 0 stone", "/setblock 2 0 0 glass", "/setblock 4 0 0 stone"]));
test("we op with pos and pos1/pos2", () => expect(compileBlueprint(
  P({ ops: [{ op: "we", command: "//set glass", pos: [0, 5, 0], pos1: [0, 0, 0], pos2: [3, 3, 3] }] }), [10, 60, 10]))
  .toEqual(["/tp @s 10 65 10", "//pos1 10,60,10", "//pos2 13,63,13", "//set glass"]));
test("command limit", () => expect(() => compileBlueprint(
  P({ ops: [{ op: "layers", at: [0, 0, 0], rows: [["S S S S S"]] }], palette: { S: "stone" } }), [0, 0, 0], { maxCommands: 3 }))
  .toThrow(BlueprintError));
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run test/blueprint/compile.test.ts` / Expected: FAIL

- [ ] **Step 3: 実装**

- [ ] **Step 4: 通過を確認** — 同コマンド / Expected: PASS

- [ ] **Step 5: Commit** — `git commit -m "feat: 設計図をコマンド列に変換"`

---

### Task 5: 設計図の照合と範囲

**Files:**
- Create: `src/blueprint/verify.ts`
- Test: `test/blueprint/verify.test.ts`

**Interfaces:**
- Consumes: `expandBlueprint`, `blockMatches`, `formatBlockSpec`, `parsePosKey`, `NotLoadedError`
- Produces:
  - `type BlockReader = (pos: Vec3Tuple) => BlockSpec | null`（null = 未ロード）
  - `type VerifyResult = { checked: number; mismatches: { pos: Vec3Tuple; expected: string; actual: string }[]; truncated: number; skippedOps: number[] }`
  - `verifyBlueprint(bp: Blueprint, origin: Vec3Tuple, readBlock: BlockReader, opts?: { maxMismatches?: number }): VerifyResult`（既定 50、`readBlock` が null を返したら `NotLoadedError` を投げる。`pos` は絶対座標）
  - `blueprintBounds(bp: Blueprint, origin: Vec3Tuple): { min: Vec3Tuple; max: Vec3Tuple } | null` — 展開ボクセルと `we` の `pos/pos1/pos2` を含む絶対範囲。空なら null

- [ ] **Step 1: 失敗するテストを書く**

```ts
const bp = BlueprintSchema.parse({ palette: { L: "lever[powered=true]" },
  ops: [{ op: "fill", from: [0, 0, 0], to: [1, 0, 0], block: "Minecraft:Stone" }, { op: "set", at: [0, 1, 0], block: "L" }] });
const world = new Map<string, BlockSpec>([
  ["10,0,0", { name: "stone", state: {} }], ["11,0,0", { name: "dirt", state: {} }],
  ["10,1,0", { name: "lever", state: { powered: "true", facing: "north" } }]]);
const reader: BlockReader = p => world.get(posKey(p)) ?? null;
test("reports mismatches in absolute coords", () => expect(verifyBlueprint(bp, [10, 0, 0], reader)).toEqual({
  checked: 3, mismatches: [{ pos: [11, 0, 0], expected: "stone", actual: "dirt" }], truncated: 0, skippedOps: [] }));
test("throws on unloaded", () => expect(() => verifyBlueprint(bp, [500, 0, 0], reader)).toThrow(NotLoadedError));
test("truncates", () => {
  const big = BlueprintSchema.parse({ ops: [{ op: "fill", from: [0, 0, 0], to: [9, 0, 9], block: "stone" }] });
  const r = verifyBlueprint(big, [0, 0, 0], () => ({ name: "air", state: {} }));
  expect(r.mismatches).toHaveLength(50); expect(r.truncated).toBe(50);
});
test("bounds include we pos", () => expect(blueprintBounds(BlueprintSchema.parse({ ops: [
  { op: "set", at: [0, 0, 0], block: "stone" }, { op: "we", command: "//sphere glass 3", pos: [5, 10, 5] }] }), [1, 1, 1]))
  .toEqual({ min: [1, 1, 1], max: [6, 11, 6] }));
```

（boolean/number の状態値の文字列化は Task 9 の `makeBlockReader` が担う。そこにもテストを置く。）

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run test/blueprint/verify.test.ts` / Expected: FAIL

- [ ] **Step 3: 実装**

- [ ] **Step 4: 通過を確認** — 同コマンド / Expected: PASS

- [ ] **Step 5: Commit** — `git commit -m "feat: 設計図と実ワールドの照合"`

---

### Task 6: 層マップ描画と読み取り範囲チェック

**Files:**
- Create: `src/inspect/layers.ts`, `src/inspect/range.ts`
- Test: `test/inspect/layers.test.ts`, `test/inspect/range.test.ts`

**Interfaces:**
- Consumes: `BlockReader`, `formatBlockSpec`, `normalizeBox`, `boxVolume`, `NotLoadedError`, `UserFacingError`
- Produces:
  - `renderLayers(from: Vec3Tuple, to: Vec3Tuple, readBlock: BlockReader): { legend: Record<string, string>; layers: { y: number; rows: string[] }[] }` — `rows[i]` は z = minZ+i の行、文字 index が x。`air` は常に `.`、その他は出現順に `A-Z`, `a-z`, `0-9` を割り当て、凡例値は `formatBlockSpec`。62 種類を超えたら `UserFacingError`（範囲を狭めるか `list` を使うよう案内）
  - `listBlocks(from, to, readBlock): { airCount: number; blocks: { pos: Vec3Tuple; block: string }[] }`
  - `assertReadableRange(from: Vec3Tuple, to: Vec3Tuple, maxVolume = 32768): [Vec3Tuple, Vec3Tuple]` — 正規化した箱を返し、超過なら `UserFacingError`

- [ ] **Step 1: 失敗するテストを書く**

```ts
const w = new Map<string, BlockSpec>([["0,0,0", { name: "stone", state: {} }], ["1,0,0", { name: "air", state: {} }],
  ["0,0,1", { name: "glass", state: {} }], ["1,0,1", { name: "stone", state: {} }]]);
const r: BlockReader = p => w.get(posKey(p)) ?? null;
test("render", () => expect(renderLayers([0, 0, 0], [1, 0, 1], r)).toEqual({
  legend: { ".": "air", A: "stone", B: "glass" }, layers: [{ y: 0, rows: ["A.", "BA"] }] }));
test("list skips air", () => expect(listBlocks([0, 0, 0], [1, 0, 1], r).airCount).toBe(1));
test("range too big", () => expect(() => assertReadableRange([0, 0, 0], [40, 40, 40])).toThrow(UserFacingError));
test("range normalized", () => expect(assertReadableRange([3, 3, 3], [0, 0, 0])).toEqual([[0, 0, 0], [3, 3, 3]]));
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run test/inspect` / Expected: FAIL

- [ ] **Step 3: 実装**

- [ ] **Step 4: 通過を確認** — 同コマンド / Expected: PASS

- [ ] **Step 5: Commit** — `git commit -m "feat: 層マップ描画と範囲チェック"`

---

### Task 7: チャットコマンド送信と応答収集

**Files:**
- Create: `src/commands/collector.ts`
- Test: `test/commands/collector.test.ts`

**Interfaces:**
- Produces:
  - `interface ChatBot { chat(msg: string): void; on(ev: "messagestr", fn: (msg: string, position: string) => void): unknown; off(ev: "messagestr", fn: (msg: string, position: string) => void): unknown }`（mineflayer の `Bot` はこれを満たす）
  - `normalizeCommand(cmd: string): string` — 前後の空白を除き、`/` で始まらなければ `/` を付ける
  - `runCommand(bot: ChatBot, command: string, collectMs = 1000): Promise<{ command: string; messages: string[] }>`
  - `runCommands(bot: ChatBot, commands: string[], opts?: { delayMs?: number; collectMs?: number }): Promise<{ sent: number; messages: string[] }>` — 各送信の間に `delayMs`（既定 50）、最後の送信後 `collectMs`（既定 1000）だけ収集を続ける
  - どちらも `position === "game_info"`（アクションバー）は除外

- [ ] **Step 1: 失敗するテストを書く**（`vi.useFakeTimers()` と `EventEmitter` 製の偽 bot）

```ts
test("normalize", () => {
  expect(normalizeCommand(" fill 0 0 0 1 1 1 stone")).toBe("/fill 0 0 0 1 1 1 stone");
  expect(normalizeCommand("//set glass")).toBe("//set glass");
});
test("collects messages within window", async () => {
  const bot = fakeBot();   // chat() で sent に積み、emit("messagestr", ...) できる
  const p = runCommand(bot, "//set stone", 1000);
  bot.emit("messagestr", "Operation completed (27 blocks affected).", "system");
  bot.emit("messagestr", "hotbar text", "game_info");
  await vi.advanceTimersByTimeAsync(1000);
  bot.emit("messagestr", "late", "system");
  expect(await p).toEqual({ command: "//set stone", messages: ["Operation completed (27 blocks affected)."] });
  expect(bot.sent).toEqual(["//set stone"]);
  expect(bot.listenerCount("messagestr")).toBe(0);
});
test("runCommands sends in order with delay", async () => {
  const bot = fakeBot();
  const p = runCommands(bot, ["setblock 0 0 0 stone", "/setblock 1 0 0 stone"], { delayMs: 50, collectMs: 100 });
  await vi.advanceTimersByTimeAsync(200);
  expect(await p).toEqual({ sent: 2, messages: [] });
  expect(bot.sent).toEqual(["/setblock 0 0 0 stone", "/setblock 1 0 0 stone"]);
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run test/commands` / Expected: FAIL

- [ ] **Step 3: 実装**

- [ ] **Step 4: 通過を確認** — 同コマンド / Expected: PASS

- [ ] **Step 5: Commit** — `git commit -m "feat: コマンド送信と応答収集"`

---

### Task 8: MCP サーバー骨格・BotManager・接続ツール・コマンドツール

**Files:**
- Create: `src/bot/manager.ts`, `src/server/result.ts`, `src/server/createServer.ts`, `src/server/tools/connection.ts`, `src/server/tools/commands.ts`, `src/index.ts`, `.mcp.json`
- Test: `test/server/createServer.test.ts`, `test/server/result.test.ts`

**Interfaces:**
- Consumes: `AppConfig`, `loadConfig`, `runCommand`, `runCommands`, `NotConnectedError`, `UserFacingError`
- Produces:
  - `class BotManager { constructor(config: AppConfig); connect(opts: Partial<Pick<AppConfig, "host"|"port"|"username"|"auth"|"version">>): Promise<ConnectResult>; disconnect(): void; get bot(): Bot /* 未接続なら NotConnectedError（最後の切断理由を含む） */; status(): StatusSnapshot }`
  - `type ConnectResult = { state: "connected"; status: StatusSnapshot } | { state: "awaiting_microsoft_login"; verificationUri: string; userCode: string; message: string }`
  - `type StatusSnapshot = { connected: boolean; lastDisconnectReason?: string; username?: string; position?: Vec3Tuple; yaw?: number; pitch?: number; gameMode?: string; health?: number; heldItem?: string | null; nearbyPlayers?: string[] }`
  - `type ToolContext = { bots: BotManager; config: AppConfig }`、各ツールファイルは `register<Category>Tools(server: McpServer, ctx: ToolContext): void` をエクスポート
  - `jsonResult(value: unknown)`（JSON 文字列 1 個の text content）、`textResult(text: string)`、`safe(handler)` — 例外を `{ content: [{ type: "text", text: message }], isError: true }` に変換。`UserFacingError` はメッセージのみ、それ以外は `Internal error: <message>`
  - `createServer(ctx: ToolContext): McpServer` — `instructions` に仕様書 §5 のフローを英語で記載

BotManager の実装メモ:
- `mineflayer.createBot({ host, port, username, auth, version, profilesFolder: ".cache/msa", onMsaCode })`。`onMsaCode` が呼ばれたら `connect` はその時点で `awaiting_microsoft_login` を返す（ログイン自体はバックグラウンドで継続、Claude は `get_status` で確認）。
- `spawn` を最大 60 秒待つ。`kicked`/`end`/`error` で `lastDisconnectReason` を記録し、内部の bot を破棄。
- 接続時に `pathfinder` プラグインを読み込む（Task 9 で使用）。
- 既に接続中に `connect` されたら、いったん切断してから接続し直す。

ツール:
- `connect`, `disconnect`, `get_status`（`get_status` は未接続でもエラーにせず `connected: false` と切断理由を返す）
- `run_command(command, collectMs?)`, `run_commands(commands[], delayMs?, collectMs?)`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/server/createServer.test.ts — SDK の InMemoryTransport で Client と接続
test("lists connection and command tools", async () => {
  const names = await listToolNames(createServer({ bots: new BotManager(loadConfig({})), config: loadConfig({}) }));
  expect(names).toEqual(expect.arrayContaining(["connect", "disconnect", "get_status", "run_command", "run_commands"]));
});
test("run_command without connection returns isError", async () => {
  const res = await callTool(server, "run_command", { command: "/time set day" });
  expect(res.isError).toBe(true);
  expect(res.content[0].text).toMatch(/connect/);
});
test("get_status without connection", async () => {
  const res = await callTool(server, "get_status", {});
  expect(JSON.parse(res.content[0].text)).toMatchObject({ connected: false });
});
// test/server/result.test.ts
test("safe hides internals for unknown errors", async () => {
  const r = await safe(async () => { throw new Error("boom"); })({});
  expect(r).toEqual({ content: [{ type: "text", text: "Internal error: boom" }], isError: true });
});
```

`listToolNames` / `callTool` は `test/helpers/mcp.ts` に置き、以降のタスクでも使う。

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run test/server` / Expected: FAIL

- [ ] **Step 3: 実装**（`index.ts`: `try { process.loadEnvFile() } catch {}` → `loadConfig(process.env)` → `createServer` → `StdioServerTransport`。`.mcp.json`: `{"mcpServers":{"minecraft":{"command":"node","args":["dist/index.js"]}}}`）

- [ ] **Step 4: 通過を確認** — Run: `npx vitest run && npm run build` / Expected: PASS、ビルド成功

- [ ] **Step 5: Commit** — `git commit -m "feat: MCPサーバー骨格と接続・コマンドツール"`

---

### Task 9: 確認ツールと設計図ツール

**Files:**
- Create: `src/inspect/blockReader.ts`, `src/blueprint/apply.ts`, `src/server/tools/inspect.ts`, `src/server/tools/blueprint.ts`
- Modify: `src/server/createServer.ts`（登録追加）
- Test: `test/inspect/blockReader.test.ts`, `test/blueprint/apply.test.ts`, `test/server/createServer.test.ts`（名前追加）

**Interfaces:**
- Consumes: `compileBlueprint`, `verifyBlueprint`, `blueprintBounds`, `renderLayers`, `listBlocks`, `assertReadableRange`, `runCommands`, `BotManager`
- Produces:
  - `makeBlockReader(bot: { blockAt(v: Vec3): { name: string; getProperties(): Record<string, unknown> } | null }): BlockReader` — プロパティ値はすべて `String(v)`
  - `type ApplyDeps = { teleport(pos: Vec3Tuple): Promise<void>; run(commands: string[]): Promise<{ sent: number; messages: string[] }> }`
  - `applyBlueprint(deps: ApplyDeps, bp: Blueprint, origin: Vec3Tuple, opts?: { dryRun?: boolean; maxCommands?: number }): Promise<{ commands: string[]; sent: number; messages: string[] }>` — compile → `dryRun` なら送らずに `sent: 0` → それ以外は範囲中心へ `teleport` してから `run`

ツール:
- `read_blocks(from, to, format: "list"|"layers")`、`get_block(x,y,z)`（`{ name, state }`、未ロードは `NotLoadedError`）、`wait_ticks(n)`（`bot.waitForTicks`）
- `apply_blueprint(blueprint, origin, dryRun?)`：`teleport` は `runCommand(bot, "/tp @s x y z")` の後 `bot.waitForChunksToLoad()`
- `verify_blueprint(blueprint, origin)`：先に範囲中心へ teleport してから照合
- 設計図の入力スキーマは `BlueprintSchema` をそのまま使う（zod のエラー文がそのまま Claude に返る）

- [ ] **Step 1: 失敗するテストを書く**

```ts
test("block reader stringifies props", () => {
  const read = makeBlockReader({ blockAt: () => ({ name: "lever", getProperties: () => ({ powered: true, face: "wall" }) }) });
  expect(read([0, 0, 0])).toEqual({ name: "lever", state: { powered: "true", face: "wall" } });
});
test("block reader null when unloaded", () => expect(makeBlockReader({ blockAt: () => null })([0, 0, 0])).toBeNull());
test("apply dryRun sends nothing", async () => {
  const deps = { teleport: vi.fn(), run: vi.fn() };
  const r = await applyBlueprint(deps, BlueprintSchema.parse({ ops: [{ op: "set", at: [0, 0, 0], block: "stone" }] }), [5, 5, 5], { dryRun: true });
  expect(r).toEqual({ commands: ["/setblock 5 5 5 stone"], sent: 0, messages: [] });
  expect(deps.run).not.toHaveBeenCalled();
});
test("apply teleports to center then runs", async () => {
  const deps = { teleport: vi.fn(async () => {}), run: vi.fn(async (c: string[]) => ({ sent: c.length, messages: [] })) };
  await applyBlueprint(deps, BlueprintSchema.parse({ ops: [{ op: "fill", from: [0, 0, 0], to: [10, 0, 10], block: "stone" }] }), [0, 64, 0]);
  expect(deps.teleport).toHaveBeenCalledWith([5, 64, 5]);
  expect(deps.run).toHaveBeenCalledWith(["/fill 0 64 0 10 64 10 stone"]);
});
// createServer.test.ts に追加: "read_blocks","get_block","wait_ticks","apply_blueprint","verify_blueprint"
```

中心座標は `Math.floor((min + max) / 2)`。

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run` / Expected: FAIL

- [ ] **Step 3: 実装**

- [ ] **Step 4: 通過を確認** — Run: `npx vitest run && npm run build` / Expected: PASS

- [ ] **Step 5: Commit** — `git commit -m "feat: 確認ツールと設計図ツール"`

---

### Task 10: 移動・操作ツール

**Files:**
- Create: `src/bot/placement.ts`, `src/server/tools/movement.ts`
- Modify: `src/server/createServer.ts`
- Test: `test/bot/placement.test.ts`, `test/server/createServer.test.ts`

**Interfaces:**
- Consumes: `BotManager`, `runCommand`, `NotLoadedError`, `UserFacingError`
- Produces: `chooseReferenceFace(target: Vec3Tuple, isSolid: (pos: Vec3Tuple) => boolean): { reference: Vec3Tuple; face: Vec3Tuple } | null` — 6 方向の隣接を「下, 上, 北(-z), 南(+z), 西(-x), 東(+x)」の順に調べ、最初の固体ブロックを参照にする。`face = target - reference`

ツール:
- `move_to(x, y, z, timeoutMs = 30000)`：`Movements` で `canDig = false`、`GoalNear(x,y,z,1)`。タイムアウトや `noPath` なら `pathfinder.stop()` し、理由と現在地を `UserFacingError` で返す
- `teleport(x, y, z)`：`/tp @s x y z` → `waitForChunksToLoad`
- `look_at(x, y, z)`：`bot.lookAt(new Vec3(x+0.5, y+0.5, z+0.5))`
- `interact_block(x, y, z)`：距離 > 4.5 なら「先に move_to か teleport」エラー。`bot.activateBlock`、その後 1 tick 待ち、操作後の `{ name, state }` を返す
- `place_block(x, y, z, block)`：`give_item` と同じ方法（Task 11 の `giveItem` を共有。Task 11 より先にやるなら `/give @s` で代用し、Task 11 で差し替え）で手に持たせ、`chooseReferenceFace` → `bot.placeBlock`。参照が見つからなければエラー
- `dig_block(x, y, z)`：`bot.dig`

- [ ] **Step 1: 失敗するテストを書く**

```ts
test("prefers block below", () => expect(chooseReferenceFace([0, 5, 0], () => true)).toEqual({ reference: [0, 4, 0], face: [0, 1, 0] }));
test("falls back to side", () => expect(chooseReferenceFace([0, 5, 0], p => p[0] === 1 && p[1] === 5 && p[2] === 0))
  .toEqual({ reference: [1, 5, 0], face: [-1, 0, 0] }));
test("none", () => expect(chooseReferenceFace([0, 5, 0], () => false)).toBeNull());
// createServer.test.ts に追加: "move_to","teleport","look_at","interact_block","place_block","dig_block"
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run` / Expected: FAIL

- [ ] **Step 3: 実装**

- [ ] **Step 4: 通過を確認** — Run: `npx vitest run && npm run build` / Expected: PASS

- [ ] **Step 5: Commit** — `git commit -m "feat: 移動・操作ツール"`

---

### Task 11: インベントリツール

**Files:**
- Create: `src/server/tools/inventory.ts`
- Modify: `src/server/createServer.ts`, `src/server/tools/movement.ts`（`place_block` を `giveItem` 利用に）
- Test: `test/server/createServer.test.ts`, `test/server/inventory.test.ts`

**Interfaces:**
- Consumes: `BotManager`, `runCommand`
- Produces: `giveItem(bot: Bot, item: string, count: number, slot?: number): Promise<{ method: "creative" | "command"; slot: number }>` — 既定 slot は `36 + bot.quickBarSlot`。`bot.registry.itemsByName[item]` がなければ `UserFacingError`。`bot.creative.setInventorySlot(slot, new Item(id, count))` を試し、失敗したら `/give @s <item> <count>` に切り替え

ツール:
- `get_inventory()`：`{ slot, name, count }` の配列 + `selectedHotbarSlot`
- `set_hotbar_slot(slot: 0-8)`
- `give_item(item, count = 1, slot?)`
- `equip(item, destination: "hand"|"off-hand"|"head"|"torso"|"legs"|"feet")`
- `drop(item, count?)`：`bot.toss`
- `open_container(x, y, z)`：`bot.openContainer` → `containerItems()` を返して閉じる
- `container_transfer(x, y, z, direction: "deposit"|"withdraw", item, count)`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// test/server/inventory.test.ts — 偽 bot（registry.itemsByName, creative.setInventorySlot, chat, quickBarSlot）
test("giveItem uses creative slot of selected hotbar", async () => {
  const bot = fakeInventoryBot({ quickBarSlot: 2 });
  expect(await giveItem(bot, "stone", 64)).toEqual({ method: "creative", slot: 38 });
});
test("giveItem falls back to /give", async () => {
  const bot = fakeInventoryBot({ creativeFails: true });
  expect((await giveItem(bot, "stone", 1)).method).toBe("command");
  expect(bot.sent).toContain("/give @s stone 1");
});
test("unknown item", async () => expect(giveItem(fakeInventoryBot({}), "nope", 1)).rejects.toThrow(UserFacingError));
// createServer.test.ts に 7 つのツール名を追加
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run` / Expected: FAIL

- [ ] **Step 3: 実装**

- [ ] **Step 4: 通過を確認** — Run: `npx vitest run && npm run build` / Expected: PASS

- [ ] **Step 5: Commit** — `git commit -m "feat: インベントリツール"`

---

### Task 12: コード実行ツール

**Files:**
- Create: `src/sandbox/runScript.ts`, `src/server/tools/script.ts`
- Modify: `src/server/createServer.ts`（`config.enableScript` が true のときだけ登録）
- Test: `test/sandbox/runScript.test.ts`, `test/server/createServer.test.ts`

**Interfaces:**
- Produces: `runScript(code: string, globals: Record<string, unknown>, timeoutMs: number): Promise<{ result: unknown; logs: string[]; error?: string }>`
  - `code` は async 関数の本体として `(async () => { <code> })()` で実行
  - コンテキストには `globals` と `log(...args)`（logs に積む）、`sleep(ms)` だけを入れる
  - 同期の無限ループは `vm` の `timeout` で、非同期の待ちは `Promise.race` とタイマーで止める。どちらも `error: "Timed out after <n>ms"`
  - 例外は `error` に入れて返す（投げない）。`result` は `JSON.stringify` できない値なら `String(result)`
- ツール `run_script(code, timeoutMs = 30000)`：`timeoutMs` は最大 120000 に切り詰め。globals は `{ bot, Vec3, readBlock: makeBlockReader(bot) }`

- [ ] **Step 1: 失敗するテストを書く**

```ts
test("returns value and logs", async () => expect(await runScript("log('hi', 1); return 1 + 1", {}, 1000))
  .toEqual({ result: 2, logs: ["hi 1"] }));
test("exposes globals", async () => expect((await runScript("return x * 2", { x: 21 }, 1000)).result).toBe(42));
test("no require/process", async () => expect((await runScript("return [typeof require, typeof process]", {}, 1000)).result)
  .toEqual(["undefined", "undefined"]));
test("async timeout", async () => expect((await runScript("await new Promise(() => {})", {}, 100)).error).toMatch(/Timed out/));
test("sync timeout", async () => expect((await runScript("while (true) {}", {}, 100)).error).toMatch(/Timed out|timed out/));
test("error captured", async () => expect((await runScript("throw new Error('x')", {}, 1000)).error).toBe("x"));
// createServer.test.ts: enableScript=false のとき "run_script" がないこと、true のときあること
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run` / Expected: FAIL

- [ ] **Step 3: 実装**

- [ ] **Step 4: 通過を確認** — Run: `npx vitest run && npm run build` / Expected: PASS

- [ ] **Step 5: Commit** — `git commit -m "feat: コード実行ツール"`

---

### Task 13: スクリーンショット

**Files:**
- Create: `src/inspect/screenshot.ts`
- Modify: `src/server/tools/inspect.ts`
- Test: `test/server/createServer.test.ts`（名前追加のみ。描画は Task 14 の結合確認で見る）

**Interfaces:**
- Produces: `takeScreenshot(bot: Bot, opts: { position: Vec3Tuple; lookAt: Vec3Tuple; width?: number; height?: number }): Promise<Buffer>`（PNG、既定 1024×576）

方式:
- `/tp @s x y z` で Bot を `position` に移動し、`lookAt` を向く → `waitForChunksToLoad`
- 初回呼び出し時に `prismarine-viewer` の `mineflayer`（`firstPerson: true`, `viewDistance: 6`）を空いているポートで起動し、`puppeteer` でヘッドレス Chromium を開く。2 回目以降は使い回す（`BotManager` の切断時に両方閉じる）
- ページで `canvas` が出るまで待ち、さらにチャンク描画のため 3 秒待ってから `page.screenshot`
- ツール `screenshot(position, lookAt, width?, height?)` は MCP の image content（`{ type: "image", data: base64, mimeType: "image/png" }`）で返す
- `puppeteer` や `prismarine-viewer` の読み込みは動的 import にし、失敗したらそのツールだけ `UserFacingError("screenshot unavailable: ...")` を返す（他のツールに影響させない）

- [ ] **Step 1: テストにツール名 `"screenshot"` を追加** — Run: `npx vitest run test/server` / Expected: FAIL

- [ ] **Step 2: 実装**

- [ ] **Step 3: 通過を確認** — Run: `npx vitest run && npm run build` / Expected: PASS

- [ ] **Step 4: Commit** — `git commit -m "feat: スクリーンショットツール"`

---

### Task 14: 結合確認スクリプトと README

**Files:**
- Create: `scripts/smoke.ts`, `README.md`

**Interfaces:**
- Consumes: `BotManager`, `applyBlueprint`, `verifyBlueprint`, `makeBlockReader`, `runCommand`, `runCommands`, `takeScreenshot`

- [ ] **Step 1: `scripts/smoke.ts` を書く** — `.env` の設定で接続 → `/gamemode creative` → Bot の現在地から x+5 の位置を `origin` に、5×4×5 の小屋（床 `fill` stone_bricks、壁 `hollow` oak_planks、ドア `set`、屋根 `layers`）を `applyBlueprint` → `verifyBlueprint` の結果を表示 → ドアに `activateBlock` してから `open` が変わったことを表示 → `takeScreenshot` を `.cache/smoke.png` に保存 → 切断。差分が 0 件でなければ終了コード 1

- [ ] **Step 2: README を書く** — 必要なもの（Node 22+、WorldEdit 入りサーバー、Bot の OP）、`.env` の設定、`npm run build`、Claude Code への登録（`.mcp.json` または `claude mcp add minecraft -- node /abs/path/dist/index.js`）、Microsoft 認証の流れ（デバイスコード）、ツール一覧、設計図フォーマット、`run_script` は `vm` で完全な隔離ではないのでローカル専用で使うこと、`MC_AGENT_ENABLE_SCRIPT`

- [ ] **Step 3: 実サーバーで確認** — Run: `npm run build && npm run smoke` / Expected: `mismatches: 0`、ドアの `open` 変化が表示され、`.cache/smoke.png` に小屋が写る。サーバーがない環境ではこのステップを「未実施」と報告する

- [ ] **Step 4: Claude Code から確認** — Claude Code を再起動して `minecraft` MCP を読み込み、「近くに小さな家を建てて、ドアが開くか確認して」と依頼し、`connect` → `apply_blueprint` → `verify_blueprint` → `interact_block` の流れが通ることを見る

- [ ] **Step 5: Commit** — `git commit -m "docs: README と結合確認スクリプト"`
