import { isUndefined } from "lodash";
import { ArrowKey, Coordinate } from "../types";

export default function getVectorByKey(
  key: string
): Coordinate<-1 | 0 | 1> | undefined {
  switch (key) {
    case "ArrowLeft":
      return { x: -1, y: 0 };
    case "ArrowRight":
      return { x: 1, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -1 };
    case "ArrowDown":
      return { x: 0, y: 1 };
    default:
      return undefined;
  }
}
