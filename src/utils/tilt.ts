import type { Cell, Coordinate } from "../types";
import clearSlack from "./clearSlack";
import compareFromVector from "./compareFromVector";
import consumeNeighbour from "./consumeNeighbour";

export default function tilt(
  vector: Coordinate<-1 | 0 | 1>,
  cells: Cell[],
): Cell[] {
  cells = cells.slice().sort(compareFromVector(vector)); // Sort cells from the furthest direction of the tilt
  cells = cells.reduce(
    // Remove all extra slack between the cells
    (cells, cell) => clearSlack({ cell, vector, cells }),
    cells,
  );
  cells = cells.reduce((cells, cell) => {
    return consumeNeighbour({ vector, cells, cell });
  }, cells);

  cells = cells.reduce(
    // Remove all extra slack between the cells, that was caused during filtering
    (cells, cell) => clearSlack({ cell, vector, cells }),
    cells,
  );

  return cells.map((cell) => {
    // Sync cell position with consumers cell position for nice animation
    if (!cell.consumedBy) {
      return cell;
    }
    const { x, y } = cells.find((other) => other.id === cell.consumedBy)!;
    return { ...cell, x, y };
  });
}
