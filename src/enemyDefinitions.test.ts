import { describe, expect, it } from "vitest";
import { ELITE_ENEMY_SETTINGS } from "./assets/enemies/eliteEnemy/eliteEnemyAsset";
import { LEAN_HUNTER_SETTINGS } from "./assets/enemies/leanHunterAsset";
import { chooseEnemyDefinition, ENEMY_DEFINITIONS } from "./enemyDefinitions";

function definition(kind: "leanHunter" | "elite") {
  const found = ENEMY_DEFINITIONS.find((enemyDefinition) => enemyDefinition.kind === kind);
  if (!found) throw new Error(`Missing enemy definition: ${kind}`);
  return found;
}

describe("ENEMY_DEFINITIONS", () => {
  it("preserves current lean hunter and elite scaling formulas", () => {
    const leanHunter = definition("leanHunter");
    const elite = definition("elite");

    expect(leanHunter.health(3)).toBe(
      LEAN_HUNTER_SETTINGS.health.base + 3 * LEAN_HUNTER_SETTINGS.health.waveGrowth,
    );
    expect(leanHunter.spawnWeight(3)).toBeCloseTo(
      Math.max(
        LEAN_HUNTER_SETTINGS.spawnWeight.min ?? -Infinity,
        LEAN_HUNTER_SETTINGS.spawnWeight.base + 3 * LEAN_HUNTER_SETTINGS.spawnWeight.waveGrowth,
      ),
    );
    expect(leanHunter.speed(3)).toBeCloseTo(
      LEAN_HUNTER_SETTINGS.movement.speed + 3 * LEAN_HUNTER_SETTINGS.movement.waveSpeedGrowth,
    );
    expect(leanHunter.radius).toBe(LEAN_HUNTER_SETTINGS.collision.radius);
    expect(leanHunter.attack).toBe(LEAN_HUNTER_SETTINGS.attacks[0]);
    expect(leanHunter.dropTable).toBe(LEAN_HUNTER_SETTINGS.dropTable);

    expect(elite.health(3)).toBe(ELITE_ENEMY_SETTINGS.health.base + 3 * ELITE_ENEMY_SETTINGS.health.waveGrowth);
    expect(elite.spawnWeight(3)).toBeCloseTo(
      Math.min(
        ELITE_ENEMY_SETTINGS.spawnWeight.max ?? Infinity,
        ELITE_ENEMY_SETTINGS.spawnWeight.base + 3 * ELITE_ENEMY_SETTINGS.spawnWeight.waveGrowth,
      ),
    );
    expect(elite.speed(3)).toBeCloseTo(
      ELITE_ENEMY_SETTINGS.movement.speed + 3 * ELITE_ENEMY_SETTINGS.movement.waveSpeedGrowth,
    );
    expect(elite.radius).toBe(ELITE_ENEMY_SETTINGS.collision.radius);
    expect(elite.attack).toBe(ELITE_ENEMY_SETTINGS.attacks[0]);
    expect(elite.dropTable).toBe(ELITE_ENEMY_SETTINGS.dropTable);
  });

  it("keeps spawn weights positive across expected waves", () => {
    for (const enemyDefinition of ENEMY_DEFINITIONS) {
      for (const wave of [1, 10, 25, 50]) {
        expect(enemyDefinition.spawnWeight(wave)).toBeGreaterThan(0);
      }
    }
  });

  it("selects enemies deterministically when an RNG is injected", () => {
    expect(chooseEnemyDefinition(1, () => 0).kind).toBe("leanHunter");
    expect(chooseEnemyDefinition(1, () => 0.999).kind).toBe("elite");
  });
});
