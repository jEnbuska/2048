import type { Cell, Coordinate } from "../types";
import { GRID_SIZE } from "../constants.ts";
import getInitialCellValue from "./getInitialCellValue";
import { range } from "./range.ts";

const coordinates: Coordinate[] = range(0, GRID_SIZE).flatMap((y) =>
  range(0, GRID_SIZE).map((x) => ({ x, y })),
);
let ids = 100;

/** add a new cell with random free coordinate inside the grid */
export default function addNewCell(cells: Cell[]): Cell[] {
  const emptyCoordinates = coordinates.filter(({ x, y }) =>
    cells.every((cell) => cell.x !== x || cell.y !== y),
  );
  if (!emptyCoordinates.length) {
    throw new Error("No empty cells");
  }
  const coordinate =
    emptyCoordinates[Math.floor(Math.random() * emptyCoordinates.length)];
  return [...cells, { ...coordinate, value: getInitialCellValue(), id: ++ids }];
}
