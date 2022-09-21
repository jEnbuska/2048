import { Coordinate, TiltDirection } from "../types";

export default function getVectorByTiltDirection(
  direction: TiltDirection
): Coordinate<-1 | 0 | 1> {
  switch (direction) {
    case "Left":
      return { x: -1, y: 0 };
    case "Right":
      return { x: 1, y: 0 };
    case "Up":
      return { x: 0, y: -1 };
    case "Down":
      return { x: 0, y: 1 };
  }
}
