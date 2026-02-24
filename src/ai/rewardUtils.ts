import { GRID_SIZE } from "../constants";
import type { Cell } from "../types";
import { countEmptyCells } from "./encoding";

/**
 * Weights used when computing the composite reward signal.
 * These can be tuned during the heuristic-tuning phase.
 *
 * Rationale for values:
 *  mergeBonus    – doubled from 1.0 so that high-value merges are the
 *                  dominant incentive, not just board topology.
 *  emptyTiles    – reduced from 2.7 to 2.0 to prevent it from swamping
 *                  the merge signal.
 *  monotonicity  – increased from 1.0 to 1.5; ordering tiles matters.
 *  cornerBonus   – unchanged; high tile in a corner is strongly desired.
 *  smoothness    – new; rewards adjacent tiles that are close in log₂
 *                  value (easy to chain-merge).
 *  maxTileBonus  – new; steady gradient for building ever-higher tiles.
 *  gameOverPenalty – increased 5× in magnitude; terminal state should
 *                  be far more costly than any single good move.
 */
export const REWARD_WEIGHTS = {
  mergeBonus: 2.0,
  emptyTiles: 2.0,
  monotonicity: 1.5,
  cornerBonus: 3.0,
  smoothness: 1.0,
  maxTileBonus: 1.0,
  gameOverPenalty: -5.0,
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
 * Smoothness score.
 *
 * Rewards boards where neighbouring non-empty tiles have close values on a
 * log₂ scale.  A "rough" board – one that alternates large and small tiles –
 * is hard to untangle, while a "smooth" board can be merged in a chain.
 * Returns a value in [0, 1].
 */
export function calculateSmoothness(cells: Cell[]): number {
  const grid = buildGrid(cells);
  let roughness = 0;
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (grid[r][c] === 0) continue;
      const val = Math.log2(grid[r][c]);
      // Right neighbour
      if (c + 1 < GRID_SIZE && grid[r][c + 1] !== 0) {
        roughness += Math.abs(val - Math.log2(grid[r][c + 1]));
      }
      // Down neighbour
      if (r + 1 < GRID_SIZE && grid[r + 1][c] !== 0) {
        roughness += Math.abs(val - Math.log2(grid[r + 1][c]));
      }
    }
  }
  // Maximum theoretical roughness: 24 adjacent pairs × max log₂ diff of 16
  // (log₂(131072) − log₂(2) = 16).  Using Math.max(0, …) guards against
  // edge-case tiles beyond the expected range.
  return Math.max(0, 1 - roughness / 384);
}

/**
 * Max-tile bonus.
 *
 * Provides a steady gradient reward proportional to the highest tile
 * currently on the board (log₂ scale).  Encourages the agent to keep
 * pushing toward higher tiles even when corner / monotonicity signals are
 * already saturated.
 * Returns a value in [0, 1].
 */
export function calculateMaxTileBonus(cells: Cell[]): number {
  const active = cells.filter((c) => !c.consumedBy);
  if (!active.length) return 0;
  const maxValue = Math.max(...active.map((c) => c.value));
  return Math.log2(maxValue) / 17; // Normalise against max exponent 17
}

/**
 * Returns true when the game has ended – the board is completely filled and
 * no adjacent tiles share the same value (no merge is possible in any
 * direction).
 */
export function isGameOver(cells: Cell[]): boolean {
  const active = cells.filter((c) => !c.consumedBy);
  // If fewer tiles than cells the board still has empty space
  if (active.length < GRID_SIZE * GRID_SIZE) return false;

  const grid = buildGrid(active);
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const val = grid[r][c];
      // Horizontally adjacent match → a merge is still possible
      if (c + 1 < GRID_SIZE && grid[r][c + 1] === val) return false;
      // Vertically adjacent match → a merge is still possible
      if (r + 1 < GRID_SIZE && grid[r + 1][c] === val) return false;
    }
  }
  return true;
}

/**
 * Composite reward used to train the DQN agent.
 *
 * Reward = mergeBonus     (log₂ of merged tile values)
 *        + emptyBonus     (number of empty cells)
 *        + monotonicity   bonus
 *        + corner         bonus
 *        + smoothness     bonus (new – adjacent tiles close in log₂ value)
 *        + maxTileBonus   (new – gradient toward higher tiles)
 *        − stagnation     penalty (wasted no-op move)
 *        − gameOverPenalty (applied when the episode ends)
 *
 * All components are normalised to roughly the same magnitude before weighting.
 */
export function calculateReward(
  prevCells: Cell[],
  nextCells: Cell[],
  prevScore: number,
  nextScore: number,
  done = false,
): number {
  const scoreDelta = nextScore - prevScore;
  const mergeBonus =
    scoreDelta > 0 ? (Math.log2(scoreDelta) / 17) * REWARD_WEIGHTS.mergeBonus : 0;

  const emptyCount = countEmptyCells(nextCells);
  const emptyBonus =
    (emptyCount / (GRID_SIZE * GRID_SIZE)) * REWARD_WEIGHTS.emptyTiles;

  const mono = calculateMonotonicity(nextCells) * REWARD_WEIGHTS.monotonicity;
  const corner = calculateCornerBonus(nextCells) * REWARD_WEIGHTS.cornerBonus;
  const smooth = calculateSmoothness(nextCells) * REWARD_WEIGHTS.smoothness;
  const maxTile = calculateMaxTileBonus(nextCells) * REWARD_WEIGHTS.maxTileBonus;

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
  const gameOverPenalty = done ? REWARD_WEIGHTS.gameOverPenalty : 0;

  return mergeBonus + emptyBonus + mono + corner + smooth + maxTile + stagnationPenalty + gameOverPenalty;
}
