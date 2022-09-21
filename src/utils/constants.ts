import { ArrowKey, Coordinate } from "../types";

export const GRID_SIZE = 4;

export const VECTORS_BY_ARROW_KEY: Record<ArrowKey, Coordinate<0 | 1 | -1>> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};
