import { describe, expect, test } from "vitest";
import { range } from "./range";

describe("range", () => {
  test("range with end only", () => {
    expect(range(4)).toStrictEqual([0, 1, 2, 3]);
  });

  test("range with start and end", () => {
    expect(range(1, 5)).toStrictEqual([1, 2, 3, 4]);
  });

  test("range with custom step", () => {
    expect(range(0, 6, 2)).toStrictEqual([0, 2, 4]);
  });

  test("range with step of 3", () => {
    expect(range(0, 9, 3)).toStrictEqual([0, 3, 6]);
  });

  test("range with empty result", () => {
    expect(range(0, 0)).toStrictEqual([]);
  });
});
