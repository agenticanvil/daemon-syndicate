import { BasicPlayerAi } from "./aiController";
import { createHeadlessGameplayView } from "./gameView";
import { GameSimulation, type GameSimulationSnapshot } from "./gameSimulation";
import { seededRandom } from "./rng";
import type { ResourceKind } from "./types";

export type SimulationRunOptions = {
  seed: string;
  seconds?: number;
  fixedDt?: number;
  controller?: BasicPlayerAi;
};

export type SimulationRunResult = {
  seed: string;
  secondsSimulated: number;
  frames: number;
  survived: boolean;
  kills: number;
  levelReached: number;
  finalHealth: number;
  finalAmmo: number;
  finalEnergy: number;
  primaryShots: number;
  novaUses: number;
  damageTaken: number;
  pickupsCollected: Partial<Record<ResourceKind, number>>;
  finalSnapshot: GameSimulationSnapshot;
};

export type SimulationBatchSummary = {
  runs: number;
  secondsPerRun: number;
  survivalRate: number;
  averageKills: number;
  medianKills: number;
  averageLevelReached: number;
  averageDamageTaken: number;
  results: SimulationRunResult[];
};

const DEFAULT_SECONDS = 120;
const DEFAULT_DT = 1 / 60;

export function runHeadlessSimulation(options: SimulationRunOptions): SimulationRunResult {
  const seconds = options.seconds ?? DEFAULT_SECONDS;
  const fixedDt = options.fixedDt ?? DEFAULT_DT;
  const frames = Math.floor(seconds / fixedDt);
  const controller = options.controller ?? new BasicPlayerAi();
  const simulation = new GameSimulation(createHeadlessGameplayView(), {
    seed: options.seed,
    rng: seededRandom(options.seed),
  });
  simulation.startNewRun();

  let primaryShots = 0;
  let novaUses = 0;
  let damageTaken = 0;
  const pickupsCollected: Partial<Record<ResourceKind, number>> = {};
  let completedFrames = 0;

  for (let frame = 0; frame < frames; frame += 1) {
    const command = controller.next(simulation.snapshot());
    const result = simulation.step(fixedDt, command);
    completedFrames += 1;

    if (result.primaryFired) primaryShots += 1;
    if (result.novaFired) novaUses += 1;
    damageTaken += result.damageTaken;
    for (const [kind, amount] of Object.entries(result.pickupsCollected) as Array<[ResourceKind, number]>) {
      pickupsCollected[kind] = (pickupsCollected[kind] ?? 0) + amount;
    }

    if (result.gameOver) break;
  }

  const finalSnapshot = simulation.snapshot();
  return {
    seed: options.seed,
    secondsSimulated: completedFrames * fixedDt,
    frames: completedFrames,
    survived: !finalSnapshot.gameOver,
    kills: finalSnapshot.kills,
    levelReached: finalSnapshot.levelNumber,
    finalHealth: finalSnapshot.player.resources.health,
    finalAmmo: finalSnapshot.player.resources.ammo,
    finalEnergy: Math.round(finalSnapshot.player.resources.energy * 100) / 100,
    primaryShots,
    novaUses,
    damageTaken,
    pickupsCollected,
    finalSnapshot,
  };
}

export function runHeadlessBatch(options: {
  runs: number;
  seconds?: number;
  seedPrefix?: string;
  fixedDt?: number;
}): SimulationBatchSummary {
  const secondsPerRun = options.seconds ?? DEFAULT_SECONDS;
  const results: SimulationRunResult[] = [];
  for (let run = 0; run < options.runs; run += 1) {
    const seed = `${options.seedPrefix ?? "sim"}-${run}`;
    results.push(runHeadlessSimulation({ seed, seconds: secondsPerRun, fixedDt: options.fixedDt }));
  }

  return {
    runs: options.runs,
    secondsPerRun,
    survivalRate: results.filter((result) => result.survived).length / Math.max(results.length, 1),
    averageKills: average(results.map((result) => result.kills)),
    medianKills: median(results.map((result) => result.kills)),
    averageLevelReached: average(results.map((result) => result.levelReached)),
    averageDamageTaken: average(results.map((result) => result.damageTaken)),
    results,
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
