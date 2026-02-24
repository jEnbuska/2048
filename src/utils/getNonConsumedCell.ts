import type { Cell, Coordinate } from "../types";

export default function getNonConsumedCell(
  cells: Cell[],
  coordinates: Coordinate,
) {
  return cells.find(
    ({ x, y, consumedBy }) =>
      x === coordinates.x && y === coordinates.y && !consumedBy,
  );
}
