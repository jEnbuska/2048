import { test, describe, expect } from "vitest";
import tilt from "./tilt";
import type { Cell } from "../types.ts";

function expectArrayContentToEqual(actual: Array<Cell>, expected: Array<Cell>) {
  expect(actual).toStrictEqual(expect.arrayContaining(expected));
  expect(expected).toStrictEqual(expect.arrayContaining(actual));
}

describe("tilt 1 cell", () => {
  describe("tilt up", () => {
    test("tilt up 1 cell", () => {
      expect(
        tilt({ x: 0, y: -1 }, [{ x: 0, y: 3, value: 2, id: 1 }]),
      ).toStrictEqual([{ x: 0, y: 0, value: 2, id: 1 }]);
    });
    test("tilt up 1 unmovable cell", () => {
      expect(
        tilt({ x: 0, y: -1 }, [{ x: 0, y: 0, value: 2, id: 1 }]),
      ).toStrictEqual([{ x: 0, y: 0, value: 2, id: 1 }]);
    });
  });
  describe("tilt down", () => {
    test("tilt down 1 cell", () => {
      expect(
        tilt({ x: 0, y: 1 }, [{ x: 0, y: 0, value: 2, id: 1 }]),
      ).toStrictEqual([{ x: 0, y: 3, value: 2, id: 1 }]);
    });
    test("tilt down 1 unmovable cell", () => {
      expect(
        tilt({ x: 0, y: 1 }, [{ x: 0, y: 3, value: 2, id: 1 }]),
      ).toStrictEqual([{ x: 0, y: 3, value: 2, id: 1 }]);
    });
  });
  describe("left", () => {
    test("tilt left 1 cell", () => {
      expect(
        tilt({ x: -1, y: 0 }, [{ x: 3, y: 0, value: 2, id: 1 }]),
      ).toStrictEqual([{ x: 0, y: 0, value: 2, id: 1 }]);
    });
    test("tilt left 1 unmovable cell", () => {
      expect(
        tilt({ x: -1, y: 0 }, [{ x: 0, y: 0, value: 2, id: 1 }]),
      ).toStrictEqual([{ x: 0, y: 0, value: 2, id: 1 }]);
    });
  });
  describe("right", () => {
    test("tilt right 1 cell", () => {
      expect(
        tilt({ x: 1, y: 0 }, [{ x: 0, y: 0, value: 2, id: 1 }]),
      ).toStrictEqual([{ x: 3, y: 0, value: 2, id: 1 }]);
    });
    test("tilt right 1 unmovable cell", () => {
      expect(
        tilt({ x: 1, y: 0 }, [{ x: 3, y: 0, value: 2, id: 1 }]),
      ).toStrictEqual([{ x: 3, y: 0, value: 2, id: 1 }]);
    });
  });
});

describe("2 cell impact tilt", () => {
  test("tilt 2 unmovable cells", () => {
    const result = tilt({ x: 0, y: -1 }, [
      { x: 0, y: 0, value: 2, id: 1 },
      { x: 0, y: 1, value: 4, id: 2 },
    ]);
    const expected = [
      { x: 0, y: 0, value: 2, id: 1 },
      { x: 0, y: 1, value: 4, id: 2 },
    ];
    expectArrayContentToEqual(result, expected);
  });

  test("tilt 2 adjacent cells", () => {
    const result = tilt({ x: 0, y: -1 }, [
      { x: 0, y: 2, value: 2, id: 1 },
      { x: 0, y: 3, value: 4, id: 2 },
    ]);
    const expected = [
      { x: 0, y: 0, value: 2, id: 1 },
      { x: 0, y: 1, value: 4, id: 2 },
    ];
    expectArrayContentToEqual(result, expected);
  });

  test("tilt 2 cells with 1 gap each", () => {
    const result = tilt({ x: 0, y: -1 }, [
      { x: 0, y: 1, value: 2, id: 1 },
      { x: 0, y: 3, value: 4, id: 2 },
    ]);
    const expected = [
      { x: 0, y: 0, value: 2, id: 1 },
      { x: 0, y: 1, value: 4, id: 2 },
    ];
    expectArrayContentToEqual(result, expected);
  });

  test("tilt 2 cells for from each other", () => {
    const result = tilt({ x: 0, y: -1 }, [
      { x: 0, y: 0, value: 2, id: 1 },
      { x: 0, y: 3, value: 4, id: 2 },
    ]);
    const expected = [
      { x: 0, y: 0, value: 2, id: 1 },
      { x: 0, y: 1, value: 4, id: 2 },
    ];
    expectArrayContentToEqual(result, expected);
  });
});

describe("2 cell merge tilt", () => {
  test("tilt 2 cells next to wall", () => {
    const result = tilt({ x: 0, y: -1 }, [
      { x: 0, y: 0, value: 2, id: 1 },
      { x: 0, y: 1, value: 2, id: 2 },
    ]);
    const expected = [
      { x: 0, y: 0, value: 2, id: 1, consumedBy: 2 },
      { x: 0, y: 0, value: 4, id: 2 },
    ];
    expectArrayContentToEqual(result, expected);
  });

  test("tilt 2 adjacent cells", () => {
    const result = tilt({ x: 0, y: -1 }, [
      { x: 0, y: 2, value: 2, id: 1 },
      { x: 0, y: 3, value: 2, id: 2 },
    ]);
    const expected = [
      { x: 0, y: 0, value: 2, id: 1, consumedBy: 2 },
      { x: 0, y: 0, value: 4, id: 2 },
    ];
    expectArrayContentToEqual(result, expected);
  });

  test("tilt 2 cells with 1 gap each", () => {
    const result = tilt({ x: 0, y: -1 }, [
      { x: 0, y: 1, value: 2, id: 1 },
      { x: 0, y: 3, value: 2, id: 2 },
    ]);
    const expected = [
      { x: 0, y: 0, value: 2, id: 1, consumedBy: 2 },
      { x: 0, y: 0, value: 4, id: 2 },
    ];
    expectArrayContentToEqual(result, expected);
  });

  test("tilt 2 cells for from each other", () => {
    const result = tilt({ x: 0, y: -1 }, [
      { x: 0, y: 0, value: 2, id: 1 },
      { x: 0, y: 3, value: 2, id: 2 },
    ]);
    const expected = [
      { x: 0, y: 0, value: 2, id: 1, consumedBy: 2 },
      { x: 0, y: 0, value: 4, id: 2 },
    ];
    expectArrayContentToEqual(result, expected);
  });
});

test("3 cell merge tilt", () => {
  const result = tilt({ x: 0, y: -1 }, [
    { x: 0, y: 0, value: 2, id: 1 },
    { x: 0, y: 1, value: 2, id: 2 },
    { x: 0, y: 2, value: 2, id: 3 },
  ]);
  expectArrayContentToEqual(result, [
    { x: 0, y: 0, value: 2, id: 1, consumedBy: 2 },
    { x: 0, y: 0, value: 4, id: 2 },
    { x: 0, y: 1, value: 2, id: 3 },
  ]);
});

describe("4 cell merge tilt", () => {
  test("merge tilt between 4 same value cells", () => {
    const result = tilt({ x: -1, y: 0 }, [
      { x: 0, y: 0, value: 2, id: 0 },
      { x: 1, y: 0, value: 2, id: 1 },
      { x: 2, y: 0, value: 2, id: 2 },
      { x: 3, y: 0, value: 2, id: 3 },
    ]);
    const expected = [
      { x: 0, y: 0, value: 2, id: 0, consumedBy: 1 },
      { x: 0, y: 0, value: 4, id: 1 },
      { x: 1, y: 0, value: 2, id: 2, consumedBy: 3 },
      { x: 1, y: 0, value: 4, id: 3 },
    ];
    expectArrayContentToEqual(result, expected);
  });

  test("merge tilt between larger and smaller cell groups", () => {
    const result = tilt({ x: -1, y: 0 }, [
      { x: 0, y: 1, value: 4, id: 4 },
      { x: 1, y: 1, value: 4, id: 5 },
      { x: 2, y: 1, value: 2, id: 6 },
      { x: 3, y: 1, value: 2, id: 7 },
    ]);
    const expected = [
      { x: 0, y: 1, value: 4, id: 4, consumedBy: 5 },
      { x: 0, y: 1, value: 8, id: 5 },
      { x: 1, y: 1, value: 2, id: 6, consumedBy: 7 },
      { x: 1, y: 1, value: 4, id: 7 },
    ];
    expectArrayContentToEqual(result, expected);
  });

  test("merge tilt between smaller and larger cell group", () => {
    const result = tilt({ x: -1, y: 0 }, [
      { x: 0, y: 2, value: 2, id: 1 },
      { x: 1, y: 2, value: 2, id: 2 },
      { x: 2, y: 2, value: 4, id: 3 },
      { x: 3, y: 2, value: 4, id: 4 },
    ]);
    const expected = [
      { x: 0, y: 2, value: 2, id: 1, consumedBy: 2 },
      { x: 0, y: 2, value: 4, id: 2 },

      { x: 1, y: 2, value: 4, id: 3, consumedBy: 4 },
      { x: 1, y: 2, value: 8, id: 4 },
    ];
    expectArrayContentToEqual(result, expected);
  });

  test("tilt with no movement returns cells regardless of input order", () => {
    // Cells already in final positions but given in reverse x order (x desc instead of x asc)
    // tilt should return them sorted, not in the same order as input
    const result = tilt({ x: -1, y: 0 }, [
      { x: 3, y: 0, value: 16, id: 4 },
      { x: 2, y: 0, value: 8, id: 3 },
      { x: 1, y: 0, value: 4, id: 2 },
      { x: 0, y: 0, value: 2, id: 1 },
    ]);
    const expected = [
      { x: 0, y: 0, value: 2, id: 1 },
      { x: 1, y: 0, value: 4, id: 2 },
      { x: 2, y: 0, value: 8, id: 3 },
      { x: 3, y: 0, value: 16, id: 4 },
    ];
    expectArrayContentToEqual(result, expected);
  });

  test("merge tilt between mixed cell group", () => {
    const result = tilt({ x: -1, y: 0 }, [
      { x: 0, y: 3, value: 2, id: 1 },
      { x: 1, y: 3, value: 2, id: 2 },
      { x: 2, y: 3, value: 4, id: 3 },
      { x: 3, y: 3, value: 2, id: 4 },
    ]);
    const expected = [
      { x: 0, y: 3, value: 2, id: 1, consumedBy: 2 },
      { x: 0, y: 3, value: 4, id: 2 },
      { x: 1, y: 3, value: 4, id: 3 },
      { x: 2, y: 3, value: 2, id: 4 },
    ];
    expectArrayContentToEqual(result, expected);
  });
});
