import type { Coordinate } from "../types";

/** Adds the given coordinates
 * addCoordinates({x: 1, y: 0}, {x: -2, y: 10}) --> {x: -1, y: 10} */
export default function addCoordinates(...args: Coordinate[]): Coordinate {
  return args.reduce(
    (acc, vector): Coordinate => {
      return { x: acc.x + vector.x, y: acc.y + vector.y };
    },
    { x: 0, y: 0 },
  );
}
