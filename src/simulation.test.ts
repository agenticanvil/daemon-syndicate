import { describe, expect, it } from "vitest";
import { runHeadlessBatch, runHeadlessSimulation } from "./simulation";

describe("headless simulation", () => {
  it("runs a deterministic AI-controlled player without browser or WebGL", () => {
    const first = runHeadlessSimulation({ seed: "deterministic-smoke", seconds: 20 });
    const second = runHeadlessSimulation({ seed: "deterministic-smoke", seconds: 20 });

    expect(first.frames).toBeGreaterThan(0);
    expect(first.kills).toBe(second.kills);
    expect(first.levelReached).toBe(second.levelReached);
    expect(first.finalHealth).toBe(second.finalHealth);
    expect(first.primaryShots).toBe(second.primaryShots);
    expect(first.novaUses).toBe(second.novaUses);
  });

  it("can batch multiple seeds for balance smoke coverage", () => {
    const summary = runHeadlessBatch({ runs: 5, seconds: 30, seedPrefix: "balance-smoke" });

    expect(summary.results).toHaveLength(5);
    expect(summary.results.every((result) => result.frames > 0)).toBe(true);
    expect(summary.averageKills).toBeGreaterThan(0);
    expect(summary.averageLevelReached).toBeGreaterThanOrEqual(1);
  });
});
