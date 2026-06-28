import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = ""] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);

const runs = Number(args.get("runs") || process.env.SIM_RUNS || 50);
const seconds = Number(args.get("seconds") || process.env.SIM_SECONDS || 120);
const seedPrefix = args.get("seed-prefix") || process.env.SIM_SEED_PREFIX || "sim";
const fixedDt = Number(args.get("dt") || process.env.SIM_DT || 1 / 60);
const outDir = resolve("tmp/sim");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const summaryPath = resolve(outDir, `summary-${timestamp}.json`);

await mkdir(outDir, { recursive: true });

const server = await createServer({
  appType: "custom",
  server: { middlewareMode: true },
  logLevel: "error",
});

try {
  const { runHeadlessBatch } = await server.ssrLoadModule("/src/simulation.ts");
  const startedAt = performance.now();
  const summary = runHeadlessBatch({ runs, seconds, seedPrefix, fixedDt });
  const elapsedMs = Math.round(performance.now() - startedAt);
  const report = {
    generatedAt: new Date().toISOString(),
    elapsedMs,
    ...summary,
  };

  await writeFile(summaryPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Simulation summary: ${summaryPath}`);
  console.log(
    JSON.stringify(
      {
        runs: report.runs,
        secondsPerRun: report.secondsPerRun,
        survivalRate: report.survivalRate,
        survivalOverTime: report.survivalOverTime,
        averageKills: report.averageKills,
        medianKills: report.medianKills,
        averageLevelReached: report.averageLevelReached,
        averagePlayerLevelReached: report.averagePlayerLevelReached,
        averageDamageTaken: report.averageDamageTaken,
        averageXpEarned: report.averageXpEarned,
        averageUpgradePointsEarned: report.averageUpgradePointsEarned,
        averageUpgradePointsSpent: report.averageUpgradePointsSpent,
        averageEnemyLevelKilled: report.averageEnemyLevelKilled,
        enemyKindKills: report.enemyKindKills,
        averageAmmoStarvationFrames: report.averageAmmoStarvationFrames,
        averageEnergyStarvationFrames: report.averageEnergyStarvationFrames,
        elapsedMs,
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
