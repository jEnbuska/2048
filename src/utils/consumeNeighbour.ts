import { Cell, Coordinate } from "../types";
import addCoordinates from "./addCoordinates";
import getNonConsumedCell from "./getNonConsumedCell";

export default function consumeNeighbour(arg: {
  vector: Coordinate<-1 | 0 | 1>;
  cells: Cell[];
  cell: Cell;
}) {
  const { vector, cells, cell } = arg;
  if (getNonConsumedCell(cells, cell)?.id !== cell.id) {
    // Consumed by another cell
    return cells;
  }
  const { x, y } = addCoordinates(cell, vector);
  const neighbour = getNonConsumedCell(cells, { x, y });
  if (neighbour?.value !== cell.value) {
    return cells;
  }
  return cells.map((c) => {
    if (c.id === neighbour?.id) {
      return { ...c, consumedBy: cell.id };
    }
    if (c.id === cell.id) {
      return { ...c, value: c.value * 2, x, y };
    }
    return c;
  });
}
