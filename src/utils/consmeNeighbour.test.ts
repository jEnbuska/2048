import { describe, expect, test } from "vitest";
import consumeNeighbour from "./consumeNeighbour";

describe("try to consume neighbour when not possible", () => {
  test("try to consume neighbour when next to wall", () => {
    const result = consumeNeighbour({
      vector: { x: 0, y: -1 },
      cells: [{ x: 0, y: 0, value: 2, id: 1 }],
      cell: { x: 0, y: 0, value: 2, id: 1 },
    });
    const expected = [{ x: 0, y: 0, value: 2, id: 1 }];
    expect(result).toStrictEqual(expected);
  });

  test("try to consume neighbour when no neighbour to consume", () => {
    const result = consumeNeighbour({
      vector: { x: 0, y: -1 },
      cells: [{ x: 0, y: 1, value: 2, id: 1 }],
      cell: { x: 0, y: 1, value: 2, id: 1 },
    });
    const expected = [{ x: 0, y: 1, value: 2, id: 1 }];
    expect(result).toStrictEqual(expected);
  });

  test("try to consume neighbour when neighbour has different value", () => {
    const result = consumeNeighbour({
      vector: { x: 0, y: -1 },
      cells: [
        { x: 0, y: 0, value: 4, id: 2 },
        { x: 0, y: 1, value: 2, id: 1 },
      ],
      cell: { x: 0, y: 1, value: 2, id: 1 },
    });
    const expected = [
      { x: 0, y: 0, value: 4, id: 2 },
      { x: 0, y: 1, value: 2, id: 1 },
    ];
    expect(result).toStrictEqual(expected);
  });

  test("try to consume neighbour when self has been consumed", () => {
    const result = consumeNeighbour({
      vector: { x: 0, y: -1 },
      cells: [{ x: 0, y: 0, value: 4, id: 2 }],
      cell: { x: 0, y: 1, value: 2, id: 1 },
    });
    const expected = [{ x: 0, y: 0, value: 4, id: 2 }];
    expect(result).toStrictEqual(expected);
  });
});
