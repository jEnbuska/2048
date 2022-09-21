import { Coordinate, SortingDirection } from "../types";

export default function compareFromVector(
  vector: Coordinate<-1 | 0 | 1>,
  direction: SortingDirection = "asc"
) {
  const multiplier = direction === "asc" ? -1 : 1;
  return (a: Coordinate, b: Coordinate) => {
    return ((a.y - b.y) * vector.y + (a.x - b.x) * vector.x) * multiplier;
  };
}
