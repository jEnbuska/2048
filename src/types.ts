export type Coordinate<T = number> = { x: T; y: T };
export type CellValues = { id: number; value: number; consumedBy?: number };
export type Cell = Coordinate & CellValues;
export type SortingDirection = "asc" | "desc";
export type TiltDirection = "Left" | "Right" | "Up" | "Down";
