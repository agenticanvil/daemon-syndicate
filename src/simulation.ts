import { BasicPlayerAi } from "./aiController";
import { WEAPON_BALANCE } from "./balance";
import type { EnemyKind } from "./enemyDefinitions";
import { createHeadlessGameplayView } from "./gameView";
import { GameSimulation, type GameSimulationSnapshot } from "./gameSimulation";
import { seededRandom } from "./rng";
import type { ResourceKind } from "./resourceTypes";
import { AUTO_UPGRADE_PRIORITY, type UpgradeId, type UpgradeOption } from "./upgrades";

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
  deathTimeSeconds?: number;
  kills: number;
  mapDepthReached: number;
  finalHealth: number;
  finalAmmo: number;
  finalEnergy: number;
  primaryShots: number;
  novaUses: number;
  damageTaken: number;
  pickupsCollected: Partial<Record<ResourceKind, number>>;
  playerLevelReached: number;
  xpEarned: number;
  upgradePointsEarned: number;
  upgradePointsSpent: number;
  averageEnemyLevelKilled: number;
  enemyKindKills: Partial<Record<EnemyKind, number>>;
  ammoStarvationFrames: number;
  energyStarvationFrames: number;
  finalSnapshot: GameSimulationSnapshot;
};

export type SimulationBatchSummary = {
  runs: number;
  secondsPerRun: number;
  survivalRate: number;
  survivalOverTime: Array<{ seconds: number; survivalRate: number; alive: number }>;
  averageKills: number;
  medianKills: number;
  averageMapDepthReached: number;
  averagePlayerLevelReached: number;
  averageDamageTaken: number;
  averageXpEarned: number;
  averageUpgradePointsEarned: number;
  averageUpgradePointsSpent: number;
  averageEnemyLevelKilled: number;
  enemyKindKills: Partial<Record<EnemyKind, number>>;
  averageAmmoStarvationFrames: number;
  averageEnergyStarvationFrames: number;
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
  let xpEarned = 0;
  const enemyLevelsKilled: number[] = [];
  const enemyKindKills: Partial<Record<EnemyKind, number>> = {};
  let ammoStarvationFrames = 0;
  let energyStarvationFrames = 0;
  const pickupsCollected: Partial<Record<ResourceKind, number>> = {};
  let completedFrames = 0;

  for (let frame = 0; frame < frames; frame += 1) {
    const command = controller.next(simulation.snapshot());
    const result = simulation.step(fixedDt, command);
    completedFrames += 1;

    if (result.primaryFired) primaryShots += 1;
    if (result.novaFired) novaUses += 1;
    damageTaken += result.damageTaken;
    for (const killed of result.killedEnemies) {
      xpEarned += killed.xpReward;
      enemyLevelsKilled.push(killed.enemyLevel);
      enemyKindKills[killed.kind] = (enemyKindKills[killed.kind] ?? 0) + 1;
    }
    for (const [kind, amount] of Object.entries(result.pickupsCollected) as Array<[ResourceKind, number]>) {
      pickupsCollected[kind] = (pickupsCollected[kind] ?? 0) + amount;
    }
    const snapshot = simulation.snapshot();
    if (snapshot.player.resources.ammo < WEAPON_BALANCE.primary.ammoCost) ammoStarvationFrames += 1;
    if (snapshot.player.resources.energy < WEAPON_BALANCE.nova.energyCost) energyStarvationFrames += 1;

    if (result.gameOver) break;
    spendAutomaticUpgrades(simulation);
  }

  const finalSnapshot = simulation.snapshot();
  return {
    seed: options.seed,
    secondsSimulated: completedFrames * fixedDt,
    frames: completedFrames,
    survived: !finalSnapshot.gameOver,
    deathTimeSeconds: finalSnapshot.gameOver ? round(completedFrames * fixedDt) : undefined,
    kills: finalSnapshot.kills,
    mapDepthReached: finalSnapshot.mapDepth,
    finalHealth: finalSnapshot.player.resources.health,
    finalAmmo: finalSnapshot.player.resources.ammo,
    finalEnergy: Math.round(finalSnapshot.player.resources.energy * 100) / 100,
    primaryShots,
    novaUses,
    damageTaken,
    pickupsCollected,
    playerLevelReached: finalSnapshot.progression.level,
    xpEarned,
    upgradePointsEarned: finalSnapshot.progression.level - 1,
    upgradePointsSpent: totalUpgradeRanks(finalSnapshot.progression.upgrades),
    averageEnemyLevelKilled: average(enemyLevelsKilled),
    enemyKindKills,
    ammoStarvationFrames,
    energyStarvationFrames,
    finalSnapshot,
  };
}

function spendAutomaticUpgrades(simulation: GameSimulation): void {
  let snapshot = simulation.snapshot();
  while (snapshot.progression.unspentUpgradePoints > 0) {
    const id = chooseAutomaticUpgrade(simulation.availableUpgrades);
    if (!id || !simulation.spendUpgrade(id)) break;
    snapshot = simulation.snapshot();
  }
}

function chooseAutomaticUpgrade(options: UpgradeOption[]): UpgradeId | undefined {
  return [...options].sort((a, b) => {
    const rankDelta = a.rank - b.rank;
    if (rankDelta !== 0) return rankDelta;
    return AUTO_UPGRADE_PRIORITY.indexOf(a.id) - AUTO_UPGRADE_PRIORITY.indexOf(b.id);
  })[0]?.id;
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
    survivalOverTime: survivalOverTime(results, secondsPerRun),
    averageKills: average(results.map((result) => result.kills)),
    medianKills: median(results.map((result) => result.kills)),
    averageMapDepthReached: average(results.map((result) => result.mapDepthReached)),
    averagePlayerLevelReached: average(results.map((result) => result.playerLevelReached)),
    averageDamageTaken: average(results.map((result) => result.damageTaken)),
    averageXpEarned: average(results.map((result) => result.xpEarned)),
    averageUpgradePointsEarned: average(results.map((result) => result.upgradePointsEarned)),
    averageUpgradePointsSpent: average(results.map((result) => result.upgradePointsSpent)),
    averageEnemyLevelKilled: average(results.map((result) => result.averageEnemyLevelKilled)),
    enemyKindKills: aggregateEnemyKindKills(results),
    averageAmmoStarvationFrames: average(results.map((result) => result.ammoStarvationFrames)),
    averageEnergyStarvationFrames: average(results.map((result) => result.energyStarvationFrames)),
    results,
  };
}

function survivalOverTime(
  results: SimulationRunResult[],
  secondsPerRun: number,
): Array<{ seconds: number; survivalRate: number; alive: number }> {
  const checkpoints = survivalCheckpoints(secondsPerRun);
  return checkpoints.map((seconds) => {
    const alive = results.filter((result) => result.secondsSimulated >= seconds).length;
    return {
      seconds,
      survivalRate: round(alive / Math.max(results.length, 1)),
      alive,
    };
  });
}

function survivalCheckpoints(secondsPerRun: number): number[] {
  const checkpoints: number[] = [];
  for (let seconds = 30; seconds < secondsPerRun; seconds += 30) {
    checkpoints.push(seconds);
  }
  if (checkpoints[checkpoints.length - 1] !== secondsPerRun) {
    checkpoints.push(secondsPerRun);
  }
  return checkpoints;
}

function aggregateEnemyKindKills(results: SimulationRunResult[]): Partial<Record<EnemyKind, number>> {
  const aggregate: Partial<Record<EnemyKind, number>> = {};
  for (const result of results) {
    for (const [kind, count] of Object.entries(result.enemyKindKills) as Array<[EnemyKind, number]>) {
      aggregate[kind] = (aggregate[kind] ?? 0) + count;
    }
  }
  return aggregate;
}

function totalUpgradeRanks(upgrades: GameSimulationSnapshot["progression"]["upgrades"]): number {
  return Object.values(upgrades).reduce((sum, rank) => sum + rank, 0);
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
