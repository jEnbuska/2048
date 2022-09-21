export type Coordinate<T = number> = { x: number; y: number };
export type CellValues = { id: number; value: number; consumedBy?: number };
export type Cell = Coordinate & CellValues;
export type SortingDirection = "asc" | "desc";
export type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";
