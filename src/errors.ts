import type { Vec3Tuple } from "./types.js";

export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotConnectedError extends UserFacingError {
  constructor() {
    super("Minecraft サーバーに接続していません。先に connect を実行してください。");
  }
}

export class NotLoadedError extends UserFacingError {
  constructor(public readonly pos: Vec3Tuple) {
    super(`チャンクが未ロードです: ${pos.join(",")}`);
  }
}

export class BlueprintError extends UserFacingError {}
