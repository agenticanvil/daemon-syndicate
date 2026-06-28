import { describe, expect, it } from "vitest";
import { ELITE_ENEMY_SETTINGS } from "./assets/enemies/eliteEnemy/eliteEnemyAsset";
import { LEAN_HUNTER_SETTINGS } from "./assets/enemies/leanHunterAsset";
import {
  chooseEnemyDefinition,
  encounterBudgetForMapLevel,
  enemyLevelForMapLevel,
  ENEMY_DEFINITIONS,
} from "./enemyDefinitions";

function definition(kind: "leanHunter" | "elite") {
  const found = ENEMY_DEFINITIONS.find((enemyDefinition) => enemyDefinition.kind === kind);
  if (!found) throw new Error(`Missing enemy definition: ${kind}`);
  return found;
}

describe("ENEMY_DEFINITIONS", () => {
  it("preserves current lean hunter and elite scaling formulas", () => {
    const leanHunter = definition("leanHunter");
    const elite = definition("elite");

    expect(leanHunter.health(3)).toBe(LEAN_HUNTER_SETTINGS.health.base + 3 * LEAN_HUNTER_SETTINGS.health.levelGrowth);
    expect(leanHunter.spawnWeight(3)).toBeCloseTo(
      Math.max(
        LEAN_HUNTER_SETTINGS.spawnWeight.min ?? -Infinity,
        LEAN_HUNTER_SETTINGS.spawnWeight.base + 3 * LEAN_HUNTER_SETTINGS.spawnWeight.levelGrowth,
      ),
    );
    expect(leanHunter.speed(3)).toBeCloseTo(
      LEAN_HUNTER_SETTINGS.movement.speed + 3 * LEAN_HUNTER_SETTINGS.movement.levelSpeedGrowth,
    );
    expect(leanHunter.attackDamage(3)).toBe(18);
    expect(leanHunter.xpReward(3)).toBe(11);
    expect(leanHunter.radius).toBe(LEAN_HUNTER_SETTINGS.collision.radius);
    expect(leanHunter.unlockMapLevel).toBe(1);
    expect(leanHunter.budgetCost).toBe(1);
    expect(leanHunter.attack).toBe(LEAN_HUNTER_SETTINGS.attacks[0]);
    expect(leanHunter.dropTable).toBe(LEAN_HUNTER_SETTINGS.dropTable);

    expect(elite.health(3)).toBe(ELITE_ENEMY_SETTINGS.health.base + 3 * ELITE_ENEMY_SETTINGS.health.levelGrowth);
    expect(elite.spawnWeight(3)).toBeCloseTo(
      Math.min(
        ELITE_ENEMY_SETTINGS.spawnWeight.max ?? Infinity,
        ELITE_ENEMY_SETTINGS.spawnWeight.base + 1 * ELITE_ENEMY_SETTINGS.spawnWeight.levelGrowth,
      ),
    );
    expect(elite.speed(3)).toBeCloseTo(
      ELITE_ENEMY_SETTINGS.movement.speed + 3 * ELITE_ENEMY_SETTINGS.movement.levelSpeedGrowth,
    );
    expect(elite.attackDamage(3)).toBe(21);
    expect(elite.xpReward(3)).toBe(23);
    expect(elite.radius).toBe(ELITE_ENEMY_SETTINGS.collision.radius);
    expect(elite.unlockMapLevel).toBe(3);
    expect(elite.budgetCost).toBe(2.4);
    expect(elite.attack).toBe(ELITE_ENEMY_SETTINGS.attacks[0]);
    expect(elite.dropTable).toBe(ELITE_ENEMY_SETTINGS.dropTable);
  });

  it("keeps unlocked spawn weights positive across expected map levels", () => {
    for (const enemyDefinition of ENEMY_DEFINITIONS) {
      for (const mapLevel of [1, 10, 25, 50]) {
        if (mapLevel >= enemyDefinition.unlockMapLevel) {
          expect(enemyDefinition.spawnWeight(mapLevel)).toBeGreaterThan(0);
        } else {
          expect(enemyDefinition.spawnWeight(mapLevel)).toBe(0);
        }
      }
    }
  });

  it("selects enemies deterministically when an RNG is injected", () => {
    expect(chooseEnemyDefinition(1, () => 0).kind).toBe("leanHunter");
    expect(chooseEnemyDefinition(1, () => 0.999).kind).toBe("leanHunter");
    expect(chooseEnemyDefinition(3, () => 0.999).kind).toBe("elite");
    expect(chooseEnemyDefinition(3, () => 0.999, { maxBudgetCost: 1 }).kind).toBe("leanHunter");
  });

  it("chooses enemy levels around the map level with a minimum of one", () => {
    expect(enemyLevelForMapLevel(1, () => 0)).toBe(1);
    expect(enemyLevelForMapLevel(4, () => 0.19)).toBe(3);
    expect(enemyLevelForMapLevel(4, () => 0.2)).toBe(4);
    expect(enemyLevelForMapLevel(4, () => 0.94)).toBe(4);
    expect(enemyLevelForMapLevel(4, () => 0.95)).toBe(5);
  });

  it("scales encounter budget by map level", () => {
    expect(encounterBudgetForMapLevel(1)).toBe(13);
    expect(encounterBudgetForMapLevel(5)).toBe(25);
  });
});
