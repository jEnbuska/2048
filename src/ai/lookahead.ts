/**
 * Lookahead search for 2048.
 *
 * Simulates up to LOOKAHEAD_DEPTH moves ahead using the heuristic board-value
 * function derived from rewardUtils.  The per-action scores can be blended
 * with the DQN's Q-values inside DQNAgent.selectActionBlended() to produce a
 * more informed action-selection decision.
 */

import type { Cell, TiltDirection } from "../types";
import tilt from "../utils/tilt";
import get2DVectorByTiltDirection from "../utils/get2DVectorByTiltDirection";
import { countEmptyCells } from "./encoding";
import {
  calculateMonotonicity,
  calculateCornerBonus,
  calculateSmoothness,
  calculateMaxTileBonus,
  REWARD_WEIGHTS,
} from "./rewardUtils";
import { ACTIONS } from "./dqnAgent";
import { GRID_SIZE } from "../constants";

// ─── Configuration ────────────────────────────────────────────────────────────

/** Number of moves to simulate ahead when scoring each candidate action. */
export const LOOKAHEAD_DEPTH = 6;

/**
 * Discount factor applied per depth level.
 * Future board values are worth slightly less than immediate ones.
 */
export const LOOKAHEAD_DISCOUNT = 0.9;

/**
 * Blend weight for the lookahead component when combining with DQN Q-values.
 * 0.0 = pure DQN, 1.0 = pure lookahead.
 */
export const LOOKAHEAD_WEIGHT = 0.6;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns a heuristic quality score for a board state.
 *
 * Uses the same components and weights as the training reward function, but
 * without a score delta – suitable for comparing single board states.
 */
export function boardHeuristicValue(cells: Cell[]): number {
  const emptyFraction = countEmptyCells(cells) / (GRID_SIZE * GRID_SIZE);
  return (
    calculateMonotonicity(cells) * REWARD_WEIGHTS.monotonicity +
    calculateCornerBonus(cells) * REWARD_WEIGHTS.cornerBonus +
    calculateSmoothness(cells) * REWARD_WEIGHTS.smoothness +
    calculateMaxTileBonus(cells) * REWARD_WEIGHTS.maxTileBonus +
    emptyFraction * REWARD_WEIGHTS.emptyTiles
  );
}

/**
 * Returns a compact string key for the active board state.
 * Used to detect no-op moves (board unchanged after a tilt).
 */
function boardKey(cells: Cell[]): string {
  return cells
    .filter((c) => !c.consumedBy)
    .map((c) => `${c.x},${c.y},${c.value}`)
    .sort()
    .join("|");
}

/**
 * Strips consumed cells from a tilt result so the next simulation step sees a
 * clean board – matching the real game's inter-move cell state.
 */
function normalizeTiltResult(cells: Cell[]): Cell[] {
  return cells.filter((c) => !c.consumedBy);
}

// ─── Recursive lookahead ─────────────────────────────────────────────────────

/**
 * Recursively evaluates the best reachable heuristic value from `cells` by
 * greedily choosing the best simulated action at each depth level.
 *
 * @param cells  Current (normalised, no consumed cells) board state.
 * @param depth  Remaining depth budget.
 */
function lookaheadValue(cells: Cell[], depth: number): number {
  if (depth <= 0) return boardHeuristicValue(cells);

  const key = boardKey(cells);
  let best = -Infinity;

  for (const direction of ACTIONS as TiltDirection[]) {
    const vector = get2DVectorByTiltDirection(direction);
    const next = normalizeTiltResult(tilt(vector, cells));
    if (boardKey(next) === key) continue; // no-op – skip
    const value =
      boardHeuristicValue(next) +
      LOOKAHEAD_DISCOUNT * lookaheadValue(next, depth - 1);
    if (value > best) best = value;
  }

  // All actions were no-ops (fully stuck) – return current board value.
  return best === -Infinity ? boardHeuristicValue(cells) : best;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Computes a per-action lookahead score for each of the 4 directions.
 *
 * For each action the function simulates the resulting board state, evaluates
 * it with the heuristic, then adds the discounted value of the best reachable
 * future state up to `depth − 1` more moves ahead.
 *
 * Returns an array of 4 numbers indexed identically to ACTIONS.
 * No-op actions (moves that don't change the board) receive -Infinity so that
 * the blending step can treat them as invalid.
 *
 * @param cells  Current board cells (may include consumed cells – they are
 *               stripped internally before simulation begins).
 * @param depth  Total lookahead depth (default: LOOKAHEAD_DEPTH).
 */
export function computeLookaheadScores(
  cells: Cell[],
  depth = LOOKAHEAD_DEPTH,
): number[] {
  const normalized = normalizeTiltResult(cells);
  const key = boardKey(normalized);

  return (ACTIONS as TiltDirection[]).map((direction) => {
    const vector = get2DVectorByTiltDirection(direction);
    const next = normalizeTiltResult(tilt(vector, normalized));
    if (boardKey(next) === key) return -Infinity; // no-op
    return (
      boardHeuristicValue(next) +
      LOOKAHEAD_DISCOUNT * lookaheadValue(next, depth - 1)
    );
  });
}
