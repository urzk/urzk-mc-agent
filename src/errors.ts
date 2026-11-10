import type { Vec3Tuple } from "./types.js";

export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotConnectedError extends UserFacingError {
  constructor(lastDisconnectReason?: string, pendingHint?: string) {
    super(
      "Minecraft サーバーに接続していません。先に connect を実行してください。" +
        (lastDisconnectReason ? ` (最後の切断理由: ${lastDisconnectReason})` : "") +
        (pendingHint ? ` (${pendingHint})` : ""),
    );
  }
}

export class NotLoadedError extends UserFacingError {
  constructor(public readonly pos: Vec3Tuple) {
    super(`チャンクが未ロードです: ${pos.join(",")}。範囲の近くへ teleport してから再実行してください（広い範囲は分割してください）`);
  }
}

export class BlueprintError extends UserFacingError {}
