# urzk-mc-agent

Claude Code から Mineflayer 製の Minecraft Bot を操作して建築・確認を行う MCP サーバーです。サーバー固有 API には依存せず、チャットコマンド（`/`、WorldEdit の `//`）とプロトコルだけで動きます。

## 必要なもの

- Node.js 22 以上
- Minecraft Java Edition サーバー（WorldEdit 入りを推奨。`we` op を使わなければ不要）
- **Bot に OP 権限が必要**です（`/fill`、`/setblock`、`/tp`、`/gamemode` を使うため）

## セットアップ

```bash
pnpm install
cp .env.example .env   # 接続先を編集
pnpm build
```

### `.env`

| 変数 | 既定値 | 説明 |
| --- | --- | --- |
| `MC_HOST` | `localhost` | サーバーのホスト |
| `MC_PORT` | `25565` | ポート |
| `MC_USERNAME` | `ClaudeBuilder` | Bot 名（offline）または Microsoft アカウントの識別名 |
| `MC_AUTH` | `offline` | `offline` または `microsoft` |
| `MC_VERSION` | （自動検出） | 例: `1.21.4` |
| `MC_AGENT_ENABLE_SCRIPT` | `true` | `false` で `run_script` ツールを登録しない |

`connect` ツールの引数で上書きもできます。

`.env` と `.cache` はカレントディレクトリではなく**パッケージルート基準**（`dist/` の一つ上）で読み書きされます。どのディレクトリから起動しても同じ場所が使われます。

## Claude Code への登録

プロジェクトルートで Claude Code を起動すると、同梱の `.mcp.json` が `minecraft` サーバーを読み込みます。

```json
{"mcpServers":{"minecraft":{"command":"node","args":["dist/index.js"]}}}
```

別のプロジェクトから使う場合は、絶対パスで登録してください（`.env` はこのパッケージ直下のものが読まれます）。

```bash
claude mcp add minecraft -- node /abs/path/to/urzk-mc-agent/dist/index.js
```

登録後は Claude Code を再起動してください。

## Microsoft 認証

`MC_AUTH=microsoft`（または `connect` の `auth: "microsoft"`）で接続すると、`connect` は接続せずにデバイスコードと認証 URL を返します。

1. 返された URL をブラウザで開き、コードを入力してサインインする
2. `get_status` を繰り返し呼び、`connected: true` になるのを待つ
3. トークンは パッケージ直下の `.cache/msa`にキャッシュされ、次回以降はコード入力が不要

Microsoft 認証では `MC_USERNAME`（`connect` の `username`）は**トークンキャッシュのキー**で、ゲーム内の名前はそのキーでサインインしたアカウントのものになります。`name_taken` で弾かれた場合、エラーに実際のプロフィール名が出るので、自分のプレイ中アカウントと同じなら別の `username` を指定して Bot 用アカウントでサインインし直してください。

## ツール一覧

| 分類 | ツール | 概要 |
| --- | --- | --- |
| 接続 | `connect` / `disconnect` / `get_status` | 接続・切断・状態確認（Microsoft ログイン待ちの確認にも使う） |
| コマンド | `run_command` / `run_commands` | チャットコマンドを実行し応答を収集（既定 1000ms） |
| 設計図 | `apply_blueprint` / `verify_blueprint` | 設計図を `/fill` `/setblock`（と WorldEdit）に展開して実行 / ワールドと照合 |
| 確認 | `read_blocks` / `get_block` / `wait_ticks` / `screenshot` | ブロック読み取り（最大 32×32×32）、tick 待ち、一人称スクリーンショット |
| 移動・操作 | `move_to` / `teleport` / `look_at` / `interact_block` / `place_block` / `dig_block` | 移動、ブロック操作（到達距離 4.5） |
| インベントリ | `get_inventory` / `set_hotbar_slot` / `give_item` / `equip` / `drop` / `open_container` / `container_transfer` | 持ち物・チェスト操作 |
| スクリプト | `run_script` | JavaScript を実行（下記の注意を参照） |

### `run_script` の注意

- Node の `vm` を使っており、**安全なサンドボックスではありません**。ローカル専用で使ってください。
- タイムアウト（既定 30000ms、最大 120000ms）は、`await` の後に実行される**同期のビジーループを中断できず**、その場合サーバー全体が固まります。ポーリングには必ず `await sleep(ms)` を使ってください。
- タイムアウトしたスクリプトはバックグラウンドで動き続ける可能性があります。
- 無効化するには `MC_AGENT_ENABLE_SCRIPT=false` を設定します。

### `screenshot` の準備

- インストールスクリプトは `pnpm-workspace.yaml` の `allowBuilds` で無効にしているため、初回のスクリーンショットの前に一度だけ次を実行してください。

  ```bash
  pnpm exec puppeteer browsers install chrome
  ```

- ビューアは `127.0.0.1` のみで待ち受けます。
- カメラの周囲 `viewDistance` チャンク（既定 4、最大 12）だけが描画されます。大きな建築の全景は `viewDistance` を上げて撮ってください（重くなり、設定は以後の呼び出しにも残ります。Bot がロードしていないチャンクは描画されません）。
- 撮影前に、送ったチャンクのメッシュ生成が終わるのを待ちます（初回の撮影で空だけが写るのを防ぐため）。
- レンダリング用アセットは MC 1.21.4 まで存在します。1.20.x は 1.20.1 の、1.21.x は 1.21.4 のアセットで描画され、それより新しいブロックはテクスチャなしになることがあります。さらに新しいメジャーバージョンは描画できません。

## 設計図フォーマット

`apply_blueprint` / `verify_blueprint` に渡す JSON です。座標は `origin` からの相対座標（整数）です。

```json
{
  "palette": { "B": "stone_bricks", "S": "oak_slab[type=bottom]" },
  "ops": [
    { "op": "hollow", "from": [0, 0, 0], "to": [4, 3, 4], "block": "oak_planks" },
    { "op": "fill", "from": [0, 0, 0], "to": [4, 0, 4], "block": "B" },
    { "op": "set", "at": [2, 1, 0], "block": "oak_door[facing=south,half=lower]" },
    { "op": "layers", "at": [0, 3, 0], "rows": [["SSSSS", "SSSSS", "SSSSS", "SSSSS", "SSSSS"]] }
  ]
}
```

- `palette`: 1 文字キー → ブロック指定。`block` や `layers` から参照する。ブロック指定は `oak_planks` や `oak_stairs[facing=east]` の形式
- `fill`: 直方体を埋める。`"replace": "glass"` を付けると範囲内のそのブロックだけを置き換える（`/fill ... replace`）。照合では、それより前の op で置いたブロックにだけ置換を反映し、op 自体は `skippedOps` に入る / `hollow`: 外殻だけ設置し内部は air
- `set`: 1 ブロック設置 / `layers`: `rows[y][z]` の文字列（文字の index が x）。palette にない文字は変更しない
- `we`: WorldEdit コマンド（`command`、`pos`、`pos1`、`pos2`）。照合の対象外
- op は順番に適用され、後の op が先の op を上書きする
- 上限: `/fill` 1 回 32768 ブロック、コマンド数 2000、照合 262144 ブロック。照合の差分は先頭 50 件まで、残りは件数のみ
- 大きな設計図は JSON ファイルに書き出し、`blueprint` の代わりに `blueprintPath`（絶対パス）で渡せる（ツール呼び出しに数十 KB の JSON を載せずに済む）
- `dryRun: true` はコマンド数と先頭 50 件のコマンドだけを返す。本実行の結果は件数と、定型でないサーバーメッセージ（エラーなど）だけ。既に同じブロックだったため何も変わらなかったコマンド（`Could not set the block` / `No blocks were filled`）は `unchangedMessages` に件数だけ数える

## 結合確認スクリプト

実サーバーに接続して、小屋の建築 → 照合 → ドア操作 → スクリーンショット（`.cache/smoke.png`）までを通します。Bot が OP であること、スクリーンショット用に Chrome をインストール済みであることが前提です。

```bash
pnpm smoke
```

照合の差分が 0 件でドアの `open` が変化すれば終了コード 0、そうでなければ 1 です。

## 開発

```bash
pnpm test      # vitest
pnpm typecheck # src / test / scripts を型チェック
```
