import { describe, expect, it } from "vitest";
import { moveAngleTowards } from "./gameView";

describe("moveAngleTowards", () => {
  it("caps large facing changes", () => {
    expect(moveAngleTowards(0, Math.PI / 2, Math.PI / 6)).toBeCloseTo(Math.PI / 6);
  });

  it("takes the shortest path across the angle wrap", () => {
    const current = Math.PI - 0.1;
    const target = -Math.PI + 0.1;

    expect(moveAngleTowards(current, target, 0.05)).toBeCloseTo(current + 0.05);
  });

  it("settles exactly on nearby targets", () => {
    expect(moveAngleTowards(0.2, 0.3, 0.5)).toBeCloseTo(0.3);
  });
});
