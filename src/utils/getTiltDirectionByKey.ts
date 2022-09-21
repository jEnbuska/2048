import { TiltDirection } from "../types";

export default function getTiltDirectionByKey(
  key: string
): TiltDirection | undefined {
  switch (key) {
    case "ArrowLeft":
      return "Left";
    case "ArrowRight":
      return "Right";
    case "ArrowUp":
      return "Up";
    case "ArrowDown":
      return "Down";
    default:
      return undefined;
  }
}
