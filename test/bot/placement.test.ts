import { describe, expect, test } from "vitest";
import { chooseReferenceFace } from "../../src/bot/placement.js";

describe("chooseReferenceFace", () => {
  test("prefers block below", () =>
    expect(chooseReferenceFace([0, 5, 0], () => true)).toEqual({ reference: [0, 4, 0], face: [0, 1, 0] }));
  test("falls back to side", () =>
    expect(chooseReferenceFace([0, 5, 0], (p) => p[0] === 1 && p[1] === 5 && p[2] === 0)).toEqual({
      reference: [1, 5, 0],
      face: [-1, 0, 0],
    }));
  test("uses block above before sides", () =>
    expect(chooseReferenceFace([0, 5, 0], (p) => p[1] === 6 || p[0] === 1)).toEqual({
      reference: [0, 6, 0],
      face: [0, -1, 0],
    }));
  test("checks north, south, west, east in order", () => {
    expect(chooseReferenceFace([0, 5, 0], (p) => p[2] === 1 || p[0] === -1)?.reference).toEqual([0, 5, 1]);
    expect(chooseReferenceFace([0, 5, 0], (p) => p[0] === 1 || p[0] === -1)?.reference).toEqual([-1, 5, 0]);
  });
  test("none", () => expect(chooseReferenceFace([0, 5, 0], () => false)).toBeNull());
});
