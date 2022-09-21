import { describe, test, expect } from "vitest";
import compareFromVector from "./compareFromVector";

describe("compareFromVector", () => {
  test("compare by y asc", () => {
    const compare = compareFromVector({ x: 0, y: 1 });
    const a = { x: 1, y: 0 };
    const b = { x: 3, y: 1 };
    expect([a, b].sort(compare)).toStrictEqual([b, a]);
  });
  test("compare by y desc", () => {
    const compare = compareFromVector({ x: 0, y: 1 }, "desc");
    const a = { x: 1, y: 0 };
    const b = { x: 3, y: 1 };
    expect([a, b].sort(compare)).toStrictEqual([a, b]);
  });

  test("compare by x asc", () => {
    const compare = compareFromVector({ x: 1, y: 0 });
    const a = { y: 1, x: 0 };
    const b = { y: 3, x: 1 };
    expect([a, b].sort(compare)).toStrictEqual([b, a]);
  });
  test("compare by x desc", () => {
    const compare = compareFromVector({ x: 1, y: 0 }, "desc");
    const a = { x: 1, y: 0 };
    const b = { x: 3, y: 1 };
    expect([a, b].sort(compare)).toStrictEqual([a, b]);
  });

  test("compare by x and y", () => {
    const compare = compareFromVector({ x: 1, y: -1 });
    const a = { x: 1, y: 0 };
    const b = { x: 3, y: 1 };
    expect([a, b].sort(compare)).toStrictEqual([b, a]);
  });

  test("compare by x and y desc", () => {
    const compare = compareFromVector({ x: 1, y: -1 }, "desc");
    const a = { x: 1, y: 0 };
    const b = { x: 3, y: 1 };
    expect([a, b].sort(compare)).toStrictEqual([a, b]);
  });
});
