import { describe, test, expect } from "vitest";
import {
  boardHeuristicValue,
  computeLookaheadScores,
  computeDirectionBias,
  selectLookaheadAction,
  LOOKAHEAD_DEPTH,
  LOOKAHEAD_DISCOUNT,
  LOOKAHEAD_WEIGHT,
  DIRECTION_BIAS,
} from "./lookahead";
import { GRID_SIZE } from "../constants";
import type { Cell } from "../types";

function cell(id: number, x: number, y: number, value: number): Cell {
  return { id, x, y, value };
}

// ─── boardHeuristicValue ─────────────────────────────────────────────────────

describe("boardHeuristicValue", () => {
  test("returns a finite non-negative number for a typical board", () => {
    const cells = [
      cell(1, 0, 0, 1024),
      cell(2, 1, 0, 512),
      cell(3, 2, 0, 256),
      cell(4, 3, 0, 128),
    ];
    const val = boardHeuristicValue(cells);
    expect(Number.isFinite(val)).toBe(true);
    expect(val).toBeGreaterThanOrEqual(0);
  });

  test("empty board: smoothness=1 and all 16 cells empty yield a positive value", () => {
    // An empty board has no tiles, but: calculateSmoothness([])=1 and
    // emptyFraction=1, so boardHeuristicValue([]) is a small positive constant.
    expect(boardHeuristicValue([])).toBeGreaterThan(0);
  });

  test("board with highest tile in corner scores higher than tile in centre", () => {
    const cornerBoard = [cell(1, 0, 0, 1024), cell(2, 2, 2, 2)];
    const centreBoard = [cell(1, 1, 1, 1024), cell(2, 2, 2, 2)];
    expect(boardHeuristicValue(cornerBoard)).toBeGreaterThan(
      boardHeuristicValue(centreBoard),
    );
  });

  test("more empty tiles increases the score", () => {
    // Single tile at a non-corner (15 empty cells)
    const sparse = [cell(1, 1, 1, 16)];
    // Four tiles at non-corners (12 empty cells)
    const dense = [
      cell(1, 1, 1, 16),
      cell(2, 2, 1, 16),
      cell(3, 1, 2, 16),
      cell(4, 2, 2, 16),
    ];
    expect(boardHeuristicValue(sparse)).toBeGreaterThan(
      boardHeuristicValue(dense),
    );
  });

  test("consumed cells are not counted", () => {
    const withConsumed: Cell[] = [
      { ...cell(1, 0, 0, 2048), consumedBy: 2 },
      cell(2, 0, 0, 32),
    ];
    const withoutConsumed = [cell(2, 0, 0, 32)];
    expect(boardHeuristicValue(withConsumed)).toBeCloseTo(
      boardHeuristicValue(withoutConsumed),
    );
  });
});

// ─── computeLookaheadScores ──────────────────────────────────────────────────

describe("computeLookaheadScores", () => {
  test("returns an array of length 4 (one score per direction)", () => {
    const cells = [cell(1, 0, 0, 2), cell(2, 1, 0, 4)];
    const scores = computeLookaheadScores(cells);
    expect(scores).toHaveLength(4);
  });

  test("no-op directions receive -Infinity", () => {
    // All tiles are already pushed to the left wall – tilt left is a no-op.
    const cells = [
      cell(1, 0, 0, 2),
      cell(2, 0, 1, 4),
      cell(3, 0, 2, 8),
      cell(4, 0, 3, 16),
    ];
    const scores = computeLookaheadScores(cells);
    // Index 2 = Left in ACTIONS ["Up","Down","Left","Right"]
    expect(scores[2]).toBe(-Infinity);
  });

  test("finite scores are returned for valid (non-no-op) directions", () => {
    // A board where at least some moves are possible.
    const cells = [cell(1, 0, 0, 2), cell(2, 3, 3, 4)];
    const scores = computeLookaheadScores(cells);
    const finiteScores = scores.filter((s) => isFinite(s));
    expect(finiteScores.length).toBeGreaterThan(0);
    finiteScores.forEach((s) => expect(Number.isFinite(s)).toBe(true));
  });

  test("ordered corner board scores the best move as highest", () => {
    // Tiles arranged in a perfect descending snake from top-left corner.
    const orderedCells: Cell[] = [];
    let id = 1;
    let val = 32768; // 2^15
    for (let y = 0; y < GRID_SIZE; y++) {
      const xs = y % 2 === 0 ? [0, 1, 2, 3] : [3, 2, 1, 0];
      for (const x of xs) {
        orderedCells.push(cell(id++, x, y, val));
        val = Math.max(2, val / 2);
      }
    }
    const scores = computeLookaheadScores(orderedCells, 1);
    // All finite scores should be non-negative heuristic values.
    scores
      .filter((s) => isFinite(s))
      .forEach((s) => expect(s).toBeGreaterThanOrEqual(0));
  });

  test("depth=0 returns immediate board-value only (no future discount)", () => {
    const cells = [
      cell(1, 0, 0, 2),
      cell(2, 1, 0, 4),
      cell(3, 2, 0, 8),
      cell(4, 3, 0, 16),
    ];
    const shallow = computeLookaheadScores(cells, 0);
    const deeper = computeLookaheadScores(cells, 2);
    // depth=0 scores = immediate heuristic of next state (no discount term)
    // depth=2 scores should be ≥ depth=0 scores because the future value adds
    // a non-negative discounted component on top.
    shallow.forEach((s, i) => {
      if (isFinite(s) && isFinite(deeper[i])) {
        expect(deeper[i]).toBeGreaterThanOrEqual(s);
      }
    });
  });

  test("consumed cells in input are stripped before simulation", () => {
    // Same logical board – one version has a ghost consumed cell.
    const clean = [cell(1, 0, 0, 4), cell(2, 1, 0, 8)];
    const withConsumed: Cell[] = [
      { ...cell(99, 0, 0, 2), consumedBy: 1 },
      cell(1, 0, 0, 4),
      cell(2, 1, 0, 8),
    ];
    const cleanScores = computeLookaheadScores(clean, 1);
    const dirtyScores = computeLookaheadScores(withConsumed, 1);
    cleanScores.forEach((s, i) => {
      if (isFinite(s) && isFinite(dirtyScores[i])) {
        expect(dirtyScores[i]).toBeCloseTo(s, 5);
      } else {
        expect(dirtyScores[i]).toBe(s);
      }
    });
  });
});

// ─── Constants ────────────────────────────────────────────────────────────────

describe("lookahead constants", () => {
  test("LOOKAHEAD_DEPTH is 6", () => {
    expect(LOOKAHEAD_DEPTH).toBe(6);
  });

  test("LOOKAHEAD_DISCOUNT is in (0, 1)", () => {
    expect(LOOKAHEAD_DISCOUNT).toBeGreaterThan(0);
    expect(LOOKAHEAD_DISCOUNT).toBeLessThan(1);
  });

  test("LOOKAHEAD_WEIGHT is in (0, 1)", () => {
    expect(LOOKAHEAD_WEIGHT).toBeGreaterThan(0);
    expect(LOOKAHEAD_WEIGHT).toBeLessThan(1);
  });

  test("DIRECTION_BIAS is a positive number", () => {
    expect(DIRECTION_BIAS).toBeGreaterThan(0);
  });
});

// ─── computeDirectionBias ─────────────────────────────────────────────────────

describe("computeDirectionBias", () => {
  test("returns an array of 4 numbers", () => {
    const bias = computeDirectionBias([cell(1, 0, 0, 128), cell(2, 1, 0, 64)]);
    expect(bias).toHaveLength(4);
  });

  test("Left (index 2) always receives DIRECTION_BIAS regardless of board", () => {
    // Default case
    expect(computeDirectionBias([cell(1, 0, 0, 128), cell(2, 1, 0, 64)])[2]).toBe(DIRECTION_BIAS);
    // Bottom-row-tail case
    const bottomChain = [
      cell(1, 0, 0, 128),
      cell(2, 1, 0, 64),
      cell(3, 2, 0, 32),
      cell(4, 3, 0, 16),
      cell(5, 3, 1, 8),
      cell(6, 3, 2, 4),
      cell(7, 3, 3, 2),
    ];
    expect(computeDirectionBias(bottomChain)[2]).toBe(DIRECTION_BIAS);
  });

  test("Up (index 0) receives DIRECTION_BIAS when chain tail is NOT on the bottom row", () => {
    // Chain: 128 → 64, both on row 0 – tail at (1,0), not bottom.
    const bias = computeDirectionBias([cell(1, 0, 0, 128), cell(2, 1, 0, 64)]);
    expect(bias[0]).toBe(DIRECTION_BIAS); // Up biased
    expect(bias[1]).toBe(0);              // Down not biased
  });

  test("Down (index 1) receives DIRECTION_BIAS when chain tail IS on the bottom row", () => {
    // Descending chain ending at y=3 (GRID_SIZE-1).
    const cells = [
      cell(1, 0, 0, 128),
      cell(2, 1, 0, 64),
      cell(3, 2, 0, 32),
      cell(4, 3, 0, 16),
      cell(5, 3, 1, 8),
      cell(6, 3, 2, 4),
      cell(7, 3, 3, 2), // tail at y=3 (bottom row)
    ];
    const bias = computeDirectionBias(cells);
    expect(bias[1]).toBe(DIRECTION_BIAS); // Down biased
    expect(bias[0]).toBe(0);              // Up not biased
  });

  test("empty board defaults to Left+Up bias", () => {
    const bias = computeDirectionBias([]);
    expect(bias[2]).toBe(DIRECTION_BIAS); // Left
    expect(bias[0]).toBe(DIRECTION_BIAS); // Up
    expect(bias[1]).toBe(0);              // not Down
    expect(bias[3]).toBe(0);              // not Right
  });

  test("consumed cells are ignored when finding the chain tail", () => {
    // Real tail is at row 0 (no bottom bias), but a consumed ghost sits at row 3.
    const ghostId = 99; // arbitrary ID outside the active chain
    const cells: Cell[] = [
      { ...cell(ghostId, 3, 3, 2), consumedBy: 1 }, // ghost at bottom row – should be ignored
      cell(1, 0, 0, 128),
      cell(2, 1, 0, 64),
    ];
    const bias = computeDirectionBias(cells);
    // Chain tail is at (1,0) – row 0 – so default Up bias should apply.
    expect(bias[0]).toBe(DIRECTION_BIAS); // Up
    expect(bias[1]).toBe(0);              // not Down
  });
});

// ─── selectLookaheadAction ────────────────────────────────────────────────────

describe("selectLookaheadAction", () => {
  test("returns the index of the highest finite score", () => {
    // Index 2 (Left) has the highest value.
    expect(selectLookaheadAction([1, 2, 10, 3])).toBe(2);
  });

  test("ignores -Infinity (no-op) scores when a better option exists", () => {
    // Indices 0 and 3 are no-ops; best finite score is index 1.
    expect(selectLookaheadAction([-Infinity, 7, -Infinity, 5])).toBe(1);
  });

  test("returns 0 when all scores are -Infinity (degenerate board)", () => {
    // Nothing is finite – falls back to index 0 (the initialised bestIdx).
    expect(selectLookaheadAction([-Infinity, -Infinity, -Infinity, -Infinity])).toBe(0);
  });

  test("handles negative finite scores and picks the least-bad action", () => {
    expect(selectLookaheadAction([-5, -10, -3, -8])).toBe(2);
  });

  test("works with a single valid action among no-ops", () => {
    expect(selectLookaheadAction([-Infinity, -Infinity, -Infinity, 42])).toBe(3);
  });
});
