export type FixedStepAdvanceResult = {
  steps: number;
  droppedSeconds: number;
  interpolationAlpha: number;
};

export const SIMULATION_STEP_SECONDS = 1 / 60;
export const MAX_SIMULATION_CATCH_UP_STEPS = 5;

export class FixedStepClock {
  private accumulatedSeconds = 0;

  constructor(
    readonly stepSeconds = SIMULATION_STEP_SECONDS,
    readonly maxCatchUpSteps = MAX_SIMULATION_CATCH_UP_STEPS,
  ) {
    if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
      throw new Error("Fixed step duration must be a positive finite number");
    }
    if (!Number.isInteger(maxCatchUpSteps) || maxCatchUpSteps <= 0) {
      throw new Error("Maximum catch-up steps must be a positive integer");
    }
  }

  advance(elapsedSeconds: number, step: (dt: number) => void): FixedStepAdvanceResult {
    const safeElapsedSeconds = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
    const maxElapsedSeconds = this.stepSeconds * this.maxCatchUpSteps;
    const acceptedSeconds = Math.min(safeElapsedSeconds, maxElapsedSeconds);
    const droppedSeconds = safeElapsedSeconds - acceptedSeconds;
    this.accumulatedSeconds += acceptedSeconds;

    let steps = 0;
    while (this.accumulatedSeconds >= this.stepSeconds && steps < this.maxCatchUpSteps) {
      this.accumulatedSeconds -= this.stepSeconds;
      step(this.stepSeconds);
      steps += 1;
    }

    return {
      steps,
      droppedSeconds,
      interpolationAlpha: this.accumulatedSeconds / this.stepSeconds,
    };
  }

  reset(): void {
    this.accumulatedSeconds = 0;
  }
}
