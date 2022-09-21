import { Coordinate } from "../types";

export default function addCoordinates(...args: Coordinate[]): Coordinate {
  return args.reduce(
    (acc, vector): Coordinate => {
      return { x: acc.x + vector.x, y: acc.y + vector.y };
    },
    { x: 0, y: 0 }
  );
}
