import { describe, expect, it } from "vitest";
import { GameSimulation } from "./gameSimulation";

describe("GameSimulation", () => {
  it("can start a new run on a requested map depth", () => {
    const simulation = new GameSimulation();

    simulation.startNewRun({ mapDepth: 5 });

    expect(simulation.snapshot().mapDepth).toBe(5);
  });

  it("clamps invalid start map depths to the first map", () => {
    const simulation = new GameSimulation();

    simulation.startNewRun({ mapDepth: 0 });

    expect(simulation.snapshot().mapDepth).toBe(1);
  });
});
