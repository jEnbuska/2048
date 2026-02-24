import { describe, test, expect } from "vitest";
import { calculateMonotonicity, calculateCornerBonus, calculateReward } from "./rewardUtils";
import { GRID_SIZE } from "../constants";
import type { Cell } from "../types";

function cell(id: number, x: number, y: number, value: number): Cell {
  return { id, x, y, value };
}

/** Build a full 4×4 monotone snake board: 2,4,8,16 / 32,64,128,256 / ... */
function snakeBoard(): Cell[] {
  const cells: Cell[] = [];
  let id = 1;
  let val = 2;
  for (let y = 0; y < GRID_SIZE; y++) {
    const row = y % 2 === 0
      ? [0, 1, 2, 3]
      : [3, 2, 1, 0]; // snake pattern
    for (const x of row) {
      cells.push(cell(id++, x, y, val));
      val *= 2;
    }
  }
  return cells;
}

describe("calculateMonotonicity", () => {
  test("empty board returns 0", () => {
    expect(calculateMonotonicity([])).toBe(0);
  });

  test("single cell returns a non-negative value", () => {
    expect(calculateMonotonicity([cell(1, 0, 0, 2)])).toBeGreaterThanOrEqual(0);
  });

  test("perfectly monotone row yields a positive score", () => {
    // Row y=0: 2, 4, 8, 16 (ascending left-to-right)
    const cells = [
      cell(1, 0, 0, 2),
      cell(2, 1, 0, 4),
      cell(3, 2, 0, 8),
      cell(4, 3, 0, 16),
    ];
    expect(calculateMonotonicity(cells)).toBeGreaterThan(0);
  });

  test("returns value in [0, 1]", () => {
    const mono = calculateMonotonicity(snakeBoard());
    expect(mono).toBeGreaterThanOrEqual(0);
    expect(mono).toBeLessThanOrEqual(1);
  });
});

describe("calculateCornerBonus", () => {
  test("empty board returns 0", () => {
    expect(calculateCornerBonus([])).toBe(0);
  });

  test("highest tile in top-left corner gives positive bonus", () => {
    const cells = [
      cell(1, 0, 0, 1024), // top-left corner
      cell(2, 1, 0, 2),
    ];
    expect(calculateCornerBonus(cells)).toBeGreaterThan(0);
  });

  test("highest tile NOT in corner gives 0", () => {
    const cells = [
      cell(1, 1, 1, 1024), // centre – not a corner
      cell(2, 0, 0, 2),
    ];
    expect(calculateCornerBonus(cells)).toBe(0);
  });

  test("highest tile in bottom-right corner gives positive bonus", () => {
    const cells = [
      cell(1, GRID_SIZE - 1, GRID_SIZE - 1, 512),
      cell(2, 0, 0, 2),
    ];
    expect(calculateCornerBonus(cells)).toBeGreaterThan(0);
  });

  test("result is in [0, 1]", () => {
    const cells = [cell(1, 0, 0, 32768)];
    const bonus = calculateCornerBonus(cells);
    expect(bonus).toBeGreaterThanOrEqual(0);
    expect(bonus).toBeLessThanOrEqual(1);
  });
});

describe("calculateReward", () => {
  const baseCells = [cell(1, 0, 0, 2), cell(2, 1, 0, 4)];

  test("returns a finite number", () => {
    const r = calculateReward(baseCells, baseCells, 0, 0);
    expect(Number.isFinite(r)).toBe(true);
  });

  test("includes empty-tile bonus: more empty cells → higher reward (all else equal)", () => {
    // Both boards have tiles at non-corner, non-monotone positions so that
    // corner and monotonicity contributions are similar; only empty tile count differs.
    const fewTiles = [cell(1, 1, 1, 2)]; // 15 empty cells
    const manyTiles = [
      cell(1, 1, 1, 2),
      cell(2, 2, 1, 2),
      cell(3, 1, 2, 2),
      cell(4, 2, 2, 2),
    ]; // 12 empty cells
    const rFew = calculateReward(fewTiles, fewTiles, 0, 0);
    const rMany = calculateReward(manyTiles, manyTiles, 0, 0);
    expect(rFew).toBeGreaterThan(rMany);
  });

  test("merge bonus increases with score delta", () => {
    const smallMerge = calculateReward(baseCells, baseCells, 0, 4);   // merged two 2s
    const largeMerge = calculateReward(baseCells, baseCells, 0, 256); // merged two 128s
    expect(largeMerge).toBeGreaterThan(smallMerge);
  });
});
