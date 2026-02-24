import { GRID_SIZE } from "../constants";
import type { Cell } from "../types";
import { countEmptyCells } from "./encoding";

/**
 * Weights used when computing the composite reward signal.
 * These can be tuned during the heuristic-tuning phase.
 */
export const REWARD_WEIGHTS = {
  mergeBonus: 1.0,
  emptyTiles: 2.7,
  monotonicity: 1.0,
  cornerBonus: 3.0,
} as const;

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Build a 4×4 grid of values (0 for empty) from the flat cell array. */
function buildGrid(cells: Cell[]): number[][] {
  const grid: number[][] = Array.from({ length: GRID_SIZE }, () =>
    Array<number>(GRID_SIZE).fill(0),
  );
  for (const cell of cells) {
    if (!cell.consumedBy) {
      grid[cell.y][cell.x] = cell.value;
    }
  }
  return grid;
}

/**
 * Monotonicity score.
 *
 * Rewards boards where tile values are monotonically ordered along each row
 * and column (i.e. high tiles cluster in a corner).  Returns a value in [0, 1].
 */
export function calculateMonotonicity(cells: Cell[]): number {
  const grid = buildGrid(cells);

  let score = 0;
  // Rows
  for (let r = 0; r < GRID_SIZE; r++) {
    let incRow = 0;
    let decRow = 0;
    for (let c = 0; c < GRID_SIZE - 1; c++) {
      const cur = Math.log2(grid[r][c] || 1);
      const next = Math.log2(grid[r][c + 1] || 1);
      if (cur <= next) incRow += next - cur;
      if (cur >= next) decRow += cur - next;
    }
    score += Math.max(incRow, decRow);
  }
  // Columns
  for (let c = 0; c < GRID_SIZE; c++) {
    let incCol = 0;
    let decCol = 0;
    for (let r = 0; r < GRID_SIZE - 1; r++) {
      const cur = Math.log2(grid[r][c] || 1);
      const next = Math.log2(grid[r + 1][c] || 1);
      if (cur <= next) incCol += next - cur;
      if (cur >= next) decCol += cur - next;
    }
    score += Math.max(incCol, decCol);
  }

  // Normalise to [0, 1]: maximum possible sum of log2 differences per line is
  // log2(65536) − log2(2) = 15, and there are 4 rows + 4 cols = 8 lines, but we
  // take max(inc, dec) per line so the theoretical max = 8 * 15 = 120.
  return score / 120;
}

/**
 * Returns a bonus for having the highest tile in a corner (strongly rewarded
 * in expert play).
 */
export function calculateCornerBonus(cells: Cell[]): number {
  const active = cells.filter((c) => !c.consumedBy);
  if (!active.length) return 0;

  const maxValue = Math.max(...active.map((c) => c.value));
  const maxLog = Math.log2(maxValue);
  const corners = [
    { x: 0, y: 0 },
    { x: GRID_SIZE - 1, y: 0 },
    { x: 0, y: GRID_SIZE - 1 },
    { x: GRID_SIZE - 1, y: GRID_SIZE - 1 },
  ];
  const inCorner = active.some(
    (c) =>
      c.value === maxValue &&
      corners.some((corner) => corner.x === c.x && corner.y === c.y),
  );
  return inCorner ? maxLog / 17 : 0; // Normalise against max exponent 17
}

// ─── main reward function ────────────────────────────────────────────────────

/**
 * Composite reward used to train the DQN agent.
 *
 * Reward = mergeBonus  (log₂ of merged tile values)
 *        + emptyBonus  (number of empty cells)
 *        + monotonicity bonus
 *        + corner bonus
 *
 * All components are normalised to roughly the same magnitude before weighting.
 */
export function calculateReward(
  prevCells: Cell[],
  nextCells: Cell[],
  prevScore: number,
  nextScore: number,
): number {
  const scoreDelta = nextScore - prevScore;
  const mergeBonus =
    scoreDelta > 0 ? (Math.log2(scoreDelta) / 17) * REWARD_WEIGHTS.mergeBonus : 0;

  const emptyCount = countEmptyCells(nextCells);
  const emptyBonus =
    (emptyCount / (GRID_SIZE * GRID_SIZE)) * REWARD_WEIGHTS.emptyTiles;

  const mono = calculateMonotonicity(nextCells) * REWARD_WEIGHTS.monotonicity;
  const corner = calculateCornerBonus(nextCells) * REWARD_WEIGHTS.cornerBonus;

  // Small penalty when the board state didn't change (wasted move).
  // Compare active-cell positions and values rather than relying on reference equality.
  const prevKey = prevCells
    .filter((c) => !c.consumedBy)
    .map((c) => `${c.x},${c.y},${c.value}`)
    .sort()
    .join("|");
  const nextKey = nextCells
    .filter((c) => !c.consumedBy)
    .map((c) => `${c.x},${c.y},${c.value}`)
    .sort()
    .join("|");
  const stagnationPenalty = prevKey === nextKey ? -0.5 : 0;

  return mergeBonus + emptyBonus + mono + corner + stagnationPenalty;
}
