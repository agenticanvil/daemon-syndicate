import { describe, expect, it } from "vitest";
import { FixedStepClock, MAX_SIMULATION_CATCH_UP_STEPS, SIMULATION_STEP_SECONDS } from "./fixedStepClock";
import { GameSimulation } from "./gameSimulation";
import { seededRandom } from "./rng";

describe("FixedStepClock", () => {
  it.each([30, 60, 120])("advances the same simulation timeline at %i rendered frames per second", (frameRate) => {
    const simulation = runSimulationAtFrameRate(frameRate);

    expect(simulation.snapshot()).toEqual(runSimulationAtFrameRate(60).snapshot());
  });

  it("bounds catch-up work and reports time discarded after a long hitch", () => {
    const clock = new FixedStepClock();
    const steps: number[] = [];

    const result = clock.advance(1, (dt) => steps.push(dt));

    expect(steps).toHaveLength(MAX_SIMULATION_CATCH_UP_STEPS);
    expect(steps.every((dt) => dt === SIMULATION_STEP_SECONDS)).toBe(true);
    expect(result.droppedSeconds).toBeCloseTo(1 - SIMULATION_STEP_SECONDS * MAX_SIMULATION_CATCH_UP_STEPS);
    expect(result.interpolationAlpha).toBeCloseTo(0);
  });

  it("can discard partial time when gameplay is paused or reset", () => {
    const clock = new FixedStepClock();
    let steps = 0;

    clock.advance(SIMULATION_STEP_SECONDS / 2, () => {
      steps += 1;
    });
    clock.reset();
    clock.advance(SIMULATION_STEP_SECONDS / 2, () => {
      steps += 1;
    });

    expect(steps).toBe(0);
  });
});

function runSimulationAtFrameRate(frameRate: number): GameSimulation {
  const simulation = new GameSimulation({
    rng: seededRandom("fixed-step-cadence"),
    seed: "fixed-step-cadence",
  });
  const clock = new FixedStepClock();
  simulation.startNewRun();

  for (let frame = 0; frame < frameRate * 2; frame += 1) {
    clock.advance(1 / frameRate, (dt) => simulation.step(dt));
  }

  return simulation;
}
