# Minecraft 建築エージェント 設計書

- 日付: 2026-11-10
- ステータス: レビュー待ち

## 1. 目的

Claude Code にプロンプトで建築依頼をすると、Claude が建築内容を考え、Mineflayer Bot を通じて Minecraft（クリエイティブモード）上に実際に建築し、必要に応じて動作確認まで行う仕組みを作る。

### 成功基準

- Claude Code から「〇〇を建てて」と依頼すると、Bot がサーバーに接続し、建築・照合・修正までを Claude が自律的に行える。
- Claude はコマンド実行（WorldEdit 含む）、移動、ボタン/レバー等の操作、インベントリ操作を行える。
- 建築結果をブロックデータで照合でき、必要に応じてスクリーンショットや仕掛けの動作テストで確認できる。

### 前提・制約

- サーバーには WorldEdit が導入済み。Paper / Spigot / Fabric のいずれでも動くよう、サーバー固有 API には依存せず、チャットコマンド（`/`・`//`）とプロトコルのみで操作する。
- Bot アカウントは OP 権限を持つ（`/gamemode` `/fill` `/setblock` `/tp` 等に必要）。
- 認証はオフライン（`online-mode=false`）と Microsoft アカウントの両方に対応し、設定で切り替える。
- ローカル／プライベート環境での利用を前提とする。

### スコープ外（YAGNI）

- Claude API を直接使うスタンドアロンエージェント
- 複数 Bot
- サバイバルモード対応
- schematic の保存・読み込み

## 2. 全体構成

```
Claude Code ──(MCP / stdio)──▶ MCPサーバー (Node.js, TypeScript, ESM)
                                 ├─ tools/      … MCPツール定義（入出力スキーマ）
                                 ├─ bot/        … Mineflayer 接続・状態管理
                                 ├─ commands/   … チャットコマンド送信と応答収集
                                 ├─ blueprint/  … 設計図の検証・コマンド変換・照合（純粋ロジック）
                                 ├─ inspect/    … ブロック読み取り・層マップ生成・スクリーンショット
                                 └─ sandbox/    … JavaScript 実行
                                        │
                                  Mineflayer Bot ──▶ Minecraft サーバー（WorldEdit 入り）
```

- MCP サーバーは Claude Code の `.mcp.json` から stdio で起動する。起動時には接続せず、`connect` ツールで Bot がログインする。
- 接続設定のデフォルト値は `.env`（`MC_HOST`, `MC_PORT`, `MC_USERNAME`, `MC_AUTH`, `MC_VERSION`）から読み、`connect` の引数で上書きできる。
- `blueprint/` は Minecraft に依存しない純粋関数として実装し、サーバーなしで単体テスト可能にする。
- コマンド応答は、送信後 `collectMs`（既定 1000ms）の間に受信したチャット／システムメッセージを収集してそのまま返す。成否の判定は Claude に任せ、プラグインやバージョンによる文言差異に依存しない。

### 主な依存ライブラリ

- `@modelcontextprotocol/sdk`（MCP サーバー）
- `mineflayer`, `mineflayer-pathfinder`, `vec3`, `minecraft-data`
- `prismarine-viewer`（スクリーンショット、ヘッドレス）
- `zod`（入力スキーマ）
- `vitest`（テスト）

## 3. MCP ツール一覧

### 接続・状態

| ツール | 内容 |
|---|---|
| `connect(host?, port?, username?, auth?: "offline"\|"microsoft", version?)` | Bot をサーバーに接続。Microsoft 認証は初回にデバイスコードを返し、トークンをキャッシュする |
| `disconnect()` | 切断 |
| `get_status()` | 座標、向き、ゲームモード、体力、手持ちアイテム、近くのプレイヤー、接続状態 |

### コマンド

| ツール | 内容 |
|---|---|
| `run_command(command, collectMs?)` | `/`・`//` コマンドを実行し、期間中のチャット応答を返す |
| `run_commands(commands[], delayMs?)` | 複数コマンドを順に実行。スパムキック対策として送信間隔を空ける（既定 50ms） |

### 移動・操作

| ツール | 内容 |
|---|---|
| `move_to(x, y, z, timeoutMs?)` | mineflayer-pathfinder で歩行移動。到達不能時は理由と現在地を返す |
| `teleport(x, y, z)` | `/tp` で移動 |
| `look_at(x, y, z)` | 指定座標を向く |
| `interact_block(x, y, z)` | ボタン、レバー、ドア、チェスト、トラップドア等を右クリック |
| `place_block(x, y, z, block, face?)` / `dig_block(x, y, z)` | 手動の設置・破壊（コマンドで難しい場合の予備） |

### インベントリ

| ツール | 内容 |
|---|---|
| `get_inventory()` | インベントリ内容 |
| `set_hotbar_slot(slot)` | 選択スロット変更 |
| `give_item(item, count, slot?)` | クリエイティブインベントリ操作でアイテム取得。失敗時は `/give` で代用 |
| `equip(item, destination)` / `drop(item, count?)` | 装備・ドロップ |
| `open_container(x, y, z)` / `container_transfer(...)` | チェスト等の内容読み取り・出し入れ |

### 確認

| ツール | 内容 |
|---|---|
| `read_blocks(from, to, format: "list"\|"layers")` | 範囲内のブロックを返す。`layers` は Y ごとの文字マップと凡例。上限約 32×32×32 |
| `get_block(x, y, z)` | 単一ブロックの名前と状態（facing, powered, open 等） |
| `screenshot(position, lookAt, width?, height?)` | 指定視点からの画像を返す（MCP image content） |
| `wait_ticks(n)` | 指定 tick 待機（レッドストーン反応待ち） |

### 設計図

| ツール | 内容 |
|---|---|
| `apply_blueprint(blueprint, origin, dryRun?)` | 設計図をコマンド列に変換して実行。`dryRun` ではコマンド列だけ返す |
| `verify_blueprint(blueprint, origin)` | 設計図と実ワールドを照合し、差分を返す |

### コード実行

| ツール | 内容 |
|---|---|
| `run_script(code, timeoutMs?)` | `bot`・`Vec3`・ヘルパーを公開した環境で JavaScript（async 関数本体）を実行し、ログと戻り値を返す |

ブロックやチャンクが未読み込みの範囲を読み取ろうとした場合、ツールはエラーで「先に近くへ `teleport` してください」と返す。

## 4. 設計図フォーマット

```json
{
  "palette": {
    "S": "stone_bricks",
    "P": "oak_planks",
    "D": "oak_door[facing=south,half=lower]",
    ".": "air"
  },
  "ops": [
    { "op": "fill",   "from": [0,0,0], "to": [8,0,8], "block": "S" },
    { "op": "hollow", "from": [0,1,0], "to": [8,4,8], "block": "P" },
    { "op": "set",    "at": [4,1,0], "block": "D" },
    { "op": "layers", "at": [0,5,0], "rows": [["SSS","S.S","SSS"]] },
    { "op": "we",     "command": "//sphere glass 3", "pos": [4,10,4] }
  ]
}
```

### ルール

- 座標はすべて `origin` からの相対座標。
- `ops` は先頭から順に適用し、後の op が前の op を上書きする。
- `palette` の値は `name[state=value,...]` 形式。`minecraft:` 接頭辞は省略可。
- `block` には palette キー、またはブロック名を直接書ける。
- `fill`: 直方体を塗りつぶす。
- `hollow`: 直方体の外殻のみ置き、内部を air にする（`/fill ... hollow` と同じ意味）。
- `set`: 1 ブロック設置。
- `layers`: `rows[y][z]` の文字列の各文字が x 方向に並ぶ。`at` が起点。palette にない文字は「変更しない」を意味する（スペース推奨）。
- `we`: WorldEdit コマンドをそのまま実行。`pos` が指定されていれば先に Bot をそこへ `/tp` する。`pos1`/`pos2` を指定した場合は `//pos1 x,y,z` / `//pos2 x,y,z` を先に送る。

### 変換ルール（`blueprint/compile`）

- `fill` / `hollow` → `/fill`。体積が 32768 を超える場合は分割する（`hollow` の分割時は面ごとの `/fill` に展開）。
- `set` → `/setblock`。
- `layers` → 同じブロックが x 方向に連続する区間は `/fill` に、単独は `/setblock` にまとめる。
- バニラコマンドを優先し、WorldEdit は `we` op でのみ使う。
- 変換結果のコマンド数が上限（既定 2000）を超えたら実行せずにエラーを返す。
- 実行前に、対象範囲が読み込み済みになるよう Bot を範囲の中心付近へ `/tp` する。

### 照合ルール（`blueprint/verify`）

- 設計図をメモリ上の期待ボクセルマップ（`Map<"x,y,z", BlockSpec>`）に展開する。`we` op は展開できないため照合対象から除外し、その旨を結果に含める。
- 実ワールドの該当座標を読み取り比較する。ブロック名は常に比較し、状態は設計図で指定されたキーのみ比較する。
- 結果: `{ checked, mismatches: [{ pos, expected, actual }], truncated, skippedOps }`。差分は先頭 50 件まで返し、超過分は件数のみ。

## 5. Claude の典型フロー

1. `connect` → `get_status`
2. 依頼内容から設計を考え、設計図を作る
3. `apply_blueprint`（必要なら先に `dryRun`）
4. `verify_blueprint` → 差分があれば修正（`apply_blueprint` の再実行や `run_command`）
5. 仕掛けがある場合: `interact_block` → `wait_ticks` → `get_block` で状態変化を確認
6. 必要に応じて `screenshot` で見た目を確認

ツールの使い方とこのフローは、MCP サーバーの instructions と README に記載し、Claude が参照できるようにする。

## 6. エラー処理

- 未接続でツールが呼ばれた場合: 「`connect` を先に呼んでください」というエラーを返す。
- 切断・キック: 理由を状態に記録し、自動再接続はしない。次のツール呼び出しで切断理由を返し、Claude が `connect` で再接続する。
- コマンド失敗（権限不足、構文エラー等）: 収集したチャット応答をそのまま返す。
- `move_to` の到達不能・タイムアウト: 理由と現在地を返す。
- `read_blocks` の範囲超過: 上限を示してエラー。
- ツール内の例外はすべて MCP のエラー結果（`isError: true`）として返し、サーバープロセスは落とさない。
- MCP は stdio を使うため、ログはすべて stderr に出す（stdout は MCP 専用）。

## 7. 安全（コード実行）

- Node の `vm` で実行し、コンテキストには `bot`, `Vec3`, `sleep`, `log` と確認系ヘルパーのみを公開する。`require`、`process`、ファイル・ネットワーク API は渡さない。
- `vm` は完全な隔離ではないため、ローカル利用前提であることを README に明記する。
- タイムアウト: 既定 30 秒、最大 120 秒。
- 環境変数 `MC_AGENT_ENABLE_SCRIPT`（既定 `true`）が `false` のときはツール自体を登録しない。

## 8. テスト

- 単体テスト（Vitest、サーバー不要）:
  - 設計図スキーマ検証
  - `compile`: fill / hollow / set / layers の変換、32768 分割、連続区間のまとめ、コマンド数上限
  - `verify`: 期待ボクセル展開、上書き順、状態キーの部分一致、`we` op の除外
  - 層マップ生成（`read_blocks` の `layers` 形式）
- 結合テスト（手動・任意）: ローカルサーバーに接続し、小屋の設計図を `apply_blueprint` → `verify_blueprint` で差分 0 になることを確認するスクリプト。

## 9. ディレクトリ構成（予定）

```
src/
  index.ts            # MCP サーバー起動
  config.ts           # .env 読み込み
  bot/                # 接続・状態
  commands/           # コマンド送信・応答収集
  blueprint/          # schema.ts, compile.ts, verify.ts, expand.ts
  inspect/            # readBlocks.ts, layers.ts, screenshot.ts
  sandbox/            # runScript.ts
  tools/              # ツール定義（カテゴリごと）
test/
scripts/              # 結合テスト用スクリプト
```
