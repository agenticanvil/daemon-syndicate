# Headless Simulation

Daemon Syndicate includes a deterministic, browser-free simulation runner for AI-controlled balance sweeps. It runs the gameplay model through `GameSimulation` with a headless `GameplayView`, so it does not need WebGL, DOM rendering, or the local dev server.

## Quick Run

Run a batch from the project root:

```sh
npm run sim -- --runs=100 --seconds=180
```

The runner writes JSON reports to:

```text
tmp/sim/
```

Each report includes a top-level summary plus per-seed results. The console prints the main aggregate metrics:

- `survivalRate`
- `survivalOverTime`
- `averageKills`
- `medianKills`
- `averageMapDepthReached`
- `averageDamageTaken`
- `averagePlayerLevelReached`
- `averageXpEarned`
- `averageUpgradePointsEarned`
- `averageUpgradePointsSpent`
- `averageEnemyLevelKilled`
- `enemyKindKills`
- `averageAmmoStarvationFrames`
- `averageEnergyStarvationFrames`
- `elapsedMs`

## Options

The script is `scripts/sim-run.mjs`. It accepts:

- `--runs=50`: number of seeded runs.
- `--seconds=120`: simulated seconds per run.
- `--seed-prefix=sim`: prefix used to create deterministic seeds like `sim-0`, `sim-1`.
- `--dt=0.0166666667`: fixed simulation timestep.

The same values can be set with environment variables:

- `SIM_RUNS`
- `SIM_SECONDS`
- `SIM_SEED_PREFIX`
- `SIM_DT`

## Test Coverage

The smoke tests live in `src/simulation.test.ts` and run with the normal test suite:

```sh
npm test
```

They verify that a single seed is deterministic and that a small multi-seed batch produces usable balance data.

## Programmatic Use

The main API lives in `src/simulation.ts`:

```ts
import { runHeadlessBatch, runHeadlessSimulation } from "./simulation";

const run = runHeadlessSimulation({
  seed: "balance-check",
  seconds: 60,
});

const summary = runHeadlessBatch({
  runs: 100,
  seconds: 180,
  seedPrefix: "balance",
});
```

Use `runHeadlessSimulation` when investigating a specific seed. Use `runHeadlessBatch` for balance checks across many seeds.

## Reading Results

Per-run results include:

- `survived`
- `deathTimeSeconds`
- `kills`
- `mapDepthReached`
- `finalHealth`, `finalAmmo`, `finalEnergy`
- `primaryShots`
- `novaUses`
- `damageTaken`
- `pickupsCollected`
- `playerLevelReached`, `xpEarned`, `upgradePointsEarned`, `upgradePointsSpent`
- `averageEnemyLevelKilled`, `enemyKindKills`
- `ammoStarvationFrames`, `energyStarvationFrames`
- `finalSnapshot`

The `finalSnapshot` is intentionally detailed and includes level, player, enemy, projectile, pickup, and effect state. Use it for debugging a bad seed, but prefer the aggregate fields for balance thresholds.

## Implementation Notes

- `src/gameSimulation.ts` owns deterministic gameplay stepping.
- `src/gameView.ts` provides both Three-backed and headless view implementations.
- `src/aiController.ts` contains the default `BasicPlayerAi`.
- `src/playerCommand.ts` is the shared command shape used by both browser input and AI input.

Balance assertions should use broad statistical thresholds rather than exact outcomes. Exact values can change when enemy behavior, drops, weapon tuning, or level generation changes.
