import { describe, expect, it } from "vitest";
import { choleskySolve } from "../src/engine/linalg";

describe("choleskySolve", () => {
  it("solves a known 3x3 SPD system", () => {
    // M x = b with x = [1, 2, 3]
    const m = Float64Array.from([4, 12, -16, 12, 37, -43, -16, -43, 98]);
    const x = [1, 2, 3];
    const b = Float64Array.from([0, 1, 2].map((i) => x.reduce((s, xj, j) => s + m[i * 3 + j]! * xj, 0)));
    const out = choleskySolve(m, b, 3);
    out.forEach((v, i) => expect(v).toBeCloseTo(x[i]!, 10));
  });

  it("rejects a matrix that is not positive definite", () => {
    const m = Float64Array.from([1, 2, 2, 1]);
    expect(() => choleskySolve(m, Float64Array.from([1, 1]), 2)).toThrow(/positive definite/);
  });
});
