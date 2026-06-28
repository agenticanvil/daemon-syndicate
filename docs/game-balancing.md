# Game Balancing

Use deterministic headless simulation sweeps as the first pass for progression and combat balance. Manual play is still useful for feel, readability, and control ergonomics, but seeded sweeps are the source of truth for whether a tuning change moves difficulty in the intended direction.

## Standard Sweep

Use this command for current run-level balance checks:

```sh
npm run sim -- --runs=100 --seconds=180 --seed-prefix=balance
```

The report is written to `tmp/sim/`. See `docs/headless-simulation.md` for the full result schema.

The current target for this prototype is roughly:

- `survivalRate`: about `0.70` after 180 seconds.
- `survivalOverTime`: a gradual decline, not a sudden cliff.
- `averageLevelReached`: useful context, but not a strict target while AI gate navigation still has path variance.
- `averageDamageTaken`: should move with difficulty changes; very low values usually mean the player is too safe.
- `averageAmmoStarvationFrames` and `averageEnergyStarvationFrames`: watch these to avoid making challenge come mostly from resource drought.

## Reading Survival Over Time

`survivalRate` alone hides when runs fail. Always inspect `survivalOverTime`.

A healthy difficulty curve should usually look like progressive attrition:

```json
[
  { "seconds": 30, "survivalRate": 0.99 },
  { "seconds": 60, "survivalRate": 0.96 },
  { "seconds": 90, "survivalRate": 0.91 },
  { "seconds": 120, "survivalRate": 0.89 },
  { "seconds": 150, "survivalRate": 0.78 },
  { "seconds": 180, "survivalRate": 0.69 }
]
```

Avoid tuning that keeps survival near `1.0` for most of the run and then drops sharply in one interval. That usually means a specific unlock, map transition, enemy mix, or resource state is causing a cliff.

## Tuning Order

Prefer changing one lever at a time, then rerunning the same seed prefix or a clearly named new one.

Good first levers:

- Enemy health growth by `enemyLevel`.
- Enemy damage growth by `enemyLevel`.
- Encounter budget by map level.
- Spawn weights and unlock map levels.
- XP thresholds and upgrade pacing.

Use speed carefully. Enemy speed affects readability, pathing, and player control feel more than health or damage. Health, damage, budget, and composition are safer difficulty levers.

## When Adding Enemies

When adding a new enemy kind:

- Set `unlockMapLevel` conservatively.
- Give it a realistic `budgetCost` so it does not silently increase total encounter pressure.
- Start with modest `spawnWeight` and inspect `enemyKindKills`.
- Check `averageEnemyLevelKilled` to make sure the new enemy is not skewing enemy-level pressure unexpectedly.
- Run at least one 100-run sweep before and after enabling it in normal spawning.

If survival drops too sharply immediately after the enemy unlocks, tune spawn weight, budget cost, or unlock level before nerfing core player systems.

## Investigating Bad Seeds

Use aggregate metrics to spot the problem, then inspect individual `results` in the JSON report.

Useful per-run fields:

- `deathTimeSeconds`
- `levelReached`
- `playerLevelReached`
- `damageTaken`
- `ammoStarvationFrames`
- `energyStarvationFrames`
- `enemyKindKills`
- `finalSnapshot`

If many failed seeds share the same death window, map level, or resource starvation signal, tune that system directly rather than applying a broad global nerf or buff.

## Verification Checklist

After a balance change:

```sh
npm test
npm run build
npm run sim -- --runs=100 --seconds=180 --seed-prefix=<change-name>
```

Record the report path and the top-level summary when making larger balance changes. Exact values will move as systems evolve, but the direction of change should be explainable from the tuning lever used.
