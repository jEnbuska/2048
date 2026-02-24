import { describe, test, expect } from "vitest";
import { encodeBoard, encodeBoardFlat, countEmptyCells, NUM_CHANNELS, TILE_EXPONENTS } from "./encoding";
import { GRID_SIZE } from "../constants";
import type { Cell } from "../types";

// Minimal cell helper
function cell(id: number, x: number, y: number, value: number): Cell {
  return { id, x, y, value };
}

describe("TILE_EXPONENTS", () => {
  test("contains 17 exponents starting at 1", () => {
    expect(TILE_EXPONENTS.length).toBe(17);
    expect(TILE_EXPONENTS[0]).toBe(1);
    expect(TILE_EXPONENTS[16]).toBe(17);
  });
});

describe("encodeBoard", () => {
  test("returns correct shape (NUM_CHANNELS × GRID_SIZE × GRID_SIZE)", () => {
    const board = encodeBoard([]);
    expect(board.length).toBe(NUM_CHANNELS);
    board.forEach((ch) => {
      expect(ch.length).toBe(GRID_SIZE);
      ch.forEach((row) => expect(row.length).toBe(GRID_SIZE));
    });
  });

  test("empty board is all zeros", () => {
    const board = encodeBoard([]);
    const flat = board.flatMap((ch) => ch.flatMap((row) => row));
    expect(flat.every((v) => v === 0)).toBe(true);
  });

  test("tile value 2 sets channel 0 (exp=1, index=0)", () => {
    const board = encodeBoard([cell(1, 0, 0, 2)]);
    expect(board[0][0][0]).toBe(1); // channel 0, row 0, col 0
    // All other positions in channel 0 are 0
    const total = board[0].flatMap((r) => r).reduce((s, v) => s + v, 0);
    expect(total).toBe(1);
  });

  test("tile value 4 sets channel 1 (exp=2, index=1)", () => {
    const board = encodeBoard([cell(1, 2, 1, 4)]);
    expect(board[1][1][2]).toBe(1); // channel 1, row 1, col 2
  });

  test("tile value 2048 sets channel 10 (exp=11, index=10)", () => {
    const board = encodeBoard([cell(1, 3, 3, 2048)]);
    expect(board[10][3][3]).toBe(1);
  });

  test("consumed cells are excluded", () => {
    const cells: Cell[] = [
      { ...cell(1, 0, 0, 2), consumedBy: 2 },
      cell(2, 0, 0, 4),
    ];
    const board = encodeBoard(cells);
    // channel 0 (value=2) should be empty
    const sumCh0 = board[0].flatMap((r) => r).reduce((s, v) => s + v, 0);
    expect(sumCh0).toBe(0);
    // channel 1 (value=4) should have one entry at (col=0, row=0)
    expect(board[1][0][0]).toBe(1);
  });

  test("two cells at different positions are both encoded", () => {
    const cells = [cell(1, 0, 0, 2), cell(2, 3, 3, 4)];
    const board = encodeBoard(cells);
    expect(board[0][0][0]).toBe(1);
    expect(board[1][3][3]).toBe(1);
  });
});

describe("encodeBoardFlat", () => {
  test("returns a Float32Array of the correct length", () => {
    const flat = encodeBoardFlat([]);
    expect(flat).toBeInstanceOf(Float32Array);
    expect(flat.length).toBe(NUM_CHANNELS * GRID_SIZE * GRID_SIZE);
  });

  test("flat encoding matches 3-D encoding", () => {
    const cells = [cell(1, 1, 2, 8), cell(2, 3, 0, 16)];
    const flat = encodeBoardFlat(cells);
    const board = encodeBoard(cells);
    let idx = 0;
    for (const ch of board) {
      for (const row of ch) {
        for (const val of row) {
          expect(flat[idx++]).toBe(val);
        }
      }
    }
  });
});

describe("countEmptyCells", () => {
  test("full empty board = 16", () => {
    expect(countEmptyCells([])).toBe(GRID_SIZE * GRID_SIZE);
  });

  test("one cell placed → 15 empty", () => {
    expect(countEmptyCells([cell(1, 0, 0, 2)])).toBe(15);
  });

  test("consumed cells do not occupy a position", () => {
    const cells: Cell[] = [
      { ...cell(1, 0, 0, 2), consumedBy: 2 },
      cell(2, 0, 0, 4),
    ];
    // consumed cell at (0,0) is excluded; survivor cell at (0,0) occupies 1 slot
    expect(countEmptyCells(cells)).toBe(15);
  });
});
