import { GRID_SIZE } from "../constants";
import type { Cell } from "../types";

/**
 * Powers of 2 used in 2048, from 2^1 to 2^17 (131072).
 * Each exponent maps to a one-hot channel (index 0 = value 2, …, index 16 = value 131072).
 */
export const TILE_EXPONENTS = Array.from({ length: 17 }, (_, i) => i + 1); // [1,2,…,17]
export const NUM_CHANNELS = TILE_EXPONENTS.length; // 17 channels

/**
 * Returns a (NUM_CHANNELS × GRID_SIZE × GRID_SIZE) one-hot encoding of the board.
 *
 * Each channel c represents tiles whose value equals 2^(c+1).
 * board[channel][row][col] === 1 when the tile at (col, row) has that value, 0 otherwise.
 */
export function encodeBoard(cells: Cell[]): number[][][] {
  // Initialise a zero-filled 3-D array [channels][rows][cols]
  const board: number[][][] = Array.from({ length: NUM_CHANNELS }, () =>
    Array.from({ length: GRID_SIZE }, () => Array<number>(GRID_SIZE).fill(0)),
  );

  for (const cell of cells) {
    if (cell.consumedBy) continue; // Consumed cells are no longer on the board
    const exp = Math.round(Math.log2(cell.value)); // e.g. value=4 → exp=2
    const channelIndex = exp - 1; // exp=2 → index 1
    if (channelIndex >= 0 && channelIndex < NUM_CHANNELS) {
      board[channelIndex][cell.y][cell.x] = 1;
    }
  }

  return board;
}

/**
 * Flattens the 3-D one-hot board into a 1-D Float32Array suitable for
 * feeding directly into a tf.tensor3d / tf.tensor4d.
 */
export function encodeBoardFlat(cells: Cell[]): Float32Array {
  const board = encodeBoard(cells);
  const flat = new Float32Array(NUM_CHANNELS * GRID_SIZE * GRID_SIZE);
  let idx = 0;
  for (const channel of board) {
    for (const row of channel) {
      for (const val of row) {
        flat[idx++] = val;
      }
    }
  }
  return flat;
}

/** Returns the number of empty cells on the board. */
export function countEmptyCells(cells: Cell[]): number {
  const occupied = new Set(
    cells.filter((c) => !c.consumedBy).map((c) => `${c.x},${c.y}`),
  );
  return GRID_SIZE * GRID_SIZE - occupied.size;
}
