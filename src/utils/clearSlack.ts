import { Cell, Coordinate } from "../types";
import addCoordinates from "./addCoordinates";
import { GRID_SIZE } from "./constants";
import getNonConsumedCell from "./getNonConsumedCell";

/** moves the given */
export default function clearSlack(arg: {
  cell: Cell;
  vector: Coordinate<-1 | 0 | 1>;
  cells: Cell[];
}): Cell[] {
  const { cell, vector, cells } = arg;
  const { x, y } = addCoordinates(cell, vector);
  const nextCell = getNonConsumedCell(cells, {
    x,
    y,
  });
  if (y < 0 || x < 0 || y >= GRID_SIZE || x >= GRID_SIZE || nextCell) {
    return cells.map((c) => (c.id === cell.id ? cell : c));
  }
  return clearSlack({ cell: { ...cell, x, y }, vector, cells });
}
