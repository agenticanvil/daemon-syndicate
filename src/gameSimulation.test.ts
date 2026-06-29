import { describe, expect, it } from "vitest";
import { createHeadlessGameplayView } from "./gameView";
import { GameSimulation } from "./gameSimulation";

describe("GameSimulation", () => {
  it("can start a new run on a requested map level", () => {
    const simulation = new GameSimulation(createHeadlessGameplayView());

    simulation.startNewRun({ mapLevel: 5 });

    expect(simulation.snapshot().levelNumber).toBe(5);
  });

  it("clamps invalid start map levels to the first map", () => {
    const simulation = new GameSimulation(createHeadlessGameplayView());

    simulation.startNewRun({ mapLevel: 0 });

    expect(simulation.snapshot().levelNumber).toBe(1);
  });
});
