import { GRID_SIZE } from "../constants";

/**
 * Returns the delay (ms) between AI moves based on the number of free cells.
 *
 * The board starts with 14 free cells (2 tiles).  As it fills up the game
 * enters its critical phase and moves should slow down to simulate careful
 * thinking.
 *
 * Anchor points (from requirements):
 *   14 free cells (2 tiles on board) → 5 ms   (fast – early game / board nearly empty)
 *    4 free cells (12 tiles on board) → 500 ms  (slow – late game / board nearly full)
 *
 * An exponential curve connects the two points:
 *   interval = 5 × 100^((maxFree − f) / 10)
 * which gives ~50 ms at 9 free cells (mid-game).
 */
export function getMoveInterval(freeCells: number): number {
  const maxFree = GRID_SIZE * GRID_SIZE - 2; // 14 – board always has ≥ 2 tiles
  const f = Math.max(0, Math.min(maxFree, freeCells));
  const exponent = (maxFree - f) / 10;
  return Math.max(5, Math.min(500, Math.round(5 * Math.pow(100, exponent))));
}
