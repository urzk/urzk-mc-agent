import { test, expect } from "vitest";
import { posKey, parsePosKey } from "../src/types.js";

test("posKey roundtrip", () => { expect(parsePosKey(posKey([-3, 64, 10]))).toEqual([-3, 64, 10]); });
