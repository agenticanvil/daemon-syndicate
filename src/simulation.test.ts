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
    expect(first.playerLevelReached).toBe(second.playerLevelReached);
    expect(first.xpEarned).toBe(second.xpEarned);
    expect(first.enemyKindKills).toEqual(second.enemyKindKills);
  });

  it("can batch multiple seeds for balance smoke coverage", () => {
    const summary = runHeadlessBatch({ runs: 5, seconds: 30, seedPrefix: "balance-smoke" });

    expect(summary.results).toHaveLength(5);
    expect(summary.results.every((result) => result.frames > 0)).toBe(true);
    expect(summary.averageKills).toBeGreaterThan(0);
    expect(summary.averageLevelReached).toBeGreaterThanOrEqual(1);
    expect(summary.averagePlayerLevelReached).toBeGreaterThanOrEqual(1);
    expect(summary.averageXpEarned).toBeGreaterThan(0);
    expect(summary.averageUpgradePointsSpent).toBeGreaterThanOrEqual(0);
    expect(summary.averageEnemyLevelKilled).toBeGreaterThanOrEqual(1);
    expect(Object.values(summary.enemyKindKills).reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0);
    expect(summary.survivalOverTime.length).toBeGreaterThan(0);
    expect(summary.survivalOverTime.at(-1)?.seconds).toBe(30);
  });
});
