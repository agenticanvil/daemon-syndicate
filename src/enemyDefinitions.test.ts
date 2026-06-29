import { describe, expect, it } from "vitest";
import { BRUTE_SETTINGS } from "./assets/enemies/brute/bruteAsset";
import { ELITE_ENEMY_SETTINGS } from "./assets/enemies/eliteEnemy/eliteEnemyAsset";
import { LEAN_HUNTER_SETTINGS } from "./assets/enemies/leanHunter/leanHunterAsset";
import { VENOM_SPITTER_SETTINGS } from "./assets/enemies/venomSpitter/venomSpitterAsset";
import {
  chooseEnemyDefinition,
  encounterBudgetForMapLevel,
  enemyLevelForMapLevel,
  ENEMY_DEFINITIONS,
  type EnemyKind,
} from "./enemyDefinitions";

function definition(kind: EnemyKind) {
  const found = ENEMY_DEFINITIONS.find((enemyDefinition) => enemyDefinition.kind === kind);
  if (!found) throw new Error(`Missing enemy definition: ${kind}`);
  return found;
}

const health = (base: number, levelGrowth: number, enemyLevel: number) =>
  Math.round((base + enemyLevel * levelGrowth) * 1.2);
const speed = (base: number, levelGrowth: number, enemyLevel: number) =>
  (base + enemyLevel * levelGrowth * 1.5) * 1.375;

describe("ENEMY_DEFINITIONS", () => {
  it("preserves current lean hunter and elite scaling formulas", () => {
    const leanHunter = definition("leanHunter");
    const venomSpitter = definition("venomSpitter");
    const elite = definition("elite");
    const brute = definition("brute");

    expect(leanHunter.health(3)).toBe(
      health(LEAN_HUNTER_SETTINGS.health.base, LEAN_HUNTER_SETTINGS.health.levelGrowth, 3),
    );
    expect(leanHunter.spawnWeight(3)).toBeCloseTo(
      Math.max(
        LEAN_HUNTER_SETTINGS.spawnWeight.min ?? -Infinity,
        LEAN_HUNTER_SETTINGS.spawnWeight.base + 3 * LEAN_HUNTER_SETTINGS.spawnWeight.levelGrowth,
      ),
    );
    expect(leanHunter.speed(3)).toBeCloseTo(
      speed(LEAN_HUNTER_SETTINGS.movement.speed, LEAN_HUNTER_SETTINGS.movement.levelSpeedGrowth, 3),
    );
    expect(leanHunter.attackDamage(3)).toBe(22);
    expect(leanHunter.xpReward(3)).toBe(11);
    expect(leanHunter.radius).toBe(LEAN_HUNTER_SETTINGS.collision.radius);
    expect(leanHunter.unlockMapLevel).toBe(1);
    expect(leanHunter.budgetCost).toBe(1);
    expect(leanHunter.attack).toBe(LEAN_HUNTER_SETTINGS.attacks[0]);
    expect(leanHunter.dropTable).toBe(LEAN_HUNTER_SETTINGS.dropTable);

    expect(venomSpitter.health(3)).toBe(
      health(VENOM_SPITTER_SETTINGS.health.base, VENOM_SPITTER_SETTINGS.health.levelGrowth, 3),
    );
    expect(venomSpitter.spawnWeight(3)).toBeCloseTo(
      Math.min(
        VENOM_SPITTER_SETTINGS.spawnWeight.max ?? Infinity,
        VENOM_SPITTER_SETTINGS.spawnWeight.base + 2 * VENOM_SPITTER_SETTINGS.spawnWeight.levelGrowth,
      ),
    );
    expect(venomSpitter.speed(3)).toBeCloseTo(
      speed(VENOM_SPITTER_SETTINGS.movement.speed, VENOM_SPITTER_SETTINGS.movement.levelSpeedGrowth, 3),
    );
    expect(venomSpitter.attackDamage(3)).toBe(16);
    expect(venomSpitter.xpReward(3)).toBe(17);
    expect(venomSpitter.radius).toBe(VENOM_SPITTER_SETTINGS.collision.radius);
    expect(venomSpitter.unlockMapLevel).toBe(2);
    expect(venomSpitter.budgetCost).toBe(1.35);
    expect(venomSpitter.attack).toBe(VENOM_SPITTER_SETTINGS.attacks[0]);
    expect(venomSpitter.dropTable).toBe(VENOM_SPITTER_SETTINGS.dropTable);

    expect(elite.health(3)).toBe(
      health(ELITE_ENEMY_SETTINGS.health.base, ELITE_ENEMY_SETTINGS.health.levelGrowth, 3),
    );
    expect(elite.spawnWeight(3)).toBeCloseTo(
      Math.min(
        ELITE_ENEMY_SETTINGS.spawnWeight.max ?? Infinity,
        ELITE_ENEMY_SETTINGS.spawnWeight.base + 1 * ELITE_ENEMY_SETTINGS.spawnWeight.levelGrowth,
      ),
    );
    expect(elite.speed(3)).toBeCloseTo(
      speed(ELITE_ENEMY_SETTINGS.movement.speed, ELITE_ENEMY_SETTINGS.movement.levelSpeedGrowth, 3),
    );
    expect(elite.attackDamage(3)).toBe(25);
    expect(elite.xpReward(3)).toBe(23);
    expect(elite.radius).toBe(ELITE_ENEMY_SETTINGS.collision.radius);
    expect(elite.unlockMapLevel).toBe(3);
    expect(elite.budgetCost).toBe(2.4);
    expect(elite.attack).toBe(ELITE_ENEMY_SETTINGS.attacks[0]);
    expect(elite.dropTable).toBe(ELITE_ENEMY_SETTINGS.dropTable);

    expect(brute.health(3)).toBe(health(BRUTE_SETTINGS.health.base, BRUTE_SETTINGS.health.levelGrowth, 3));
    expect(brute.spawnWeight(6)).toBeCloseTo(
      Math.min(
        BRUTE_SETTINGS.spawnWeight.max ?? Infinity,
        BRUTE_SETTINGS.spawnWeight.base + 2 * BRUTE_SETTINGS.spawnWeight.levelGrowth,
      ),
    );
    expect(brute.speed(3)).toBeCloseTo(
      speed(BRUTE_SETTINGS.movement.speed, BRUTE_SETTINGS.movement.levelSpeedGrowth, 3),
    );
    expect(brute.attackDamage(3)).toBe(43);
    expect(brute.xpReward(3)).toBe(37);
    expect(brute.radius).toBe(BRUTE_SETTINGS.collision.radius);
    expect(brute.unlockMapLevel).toBe(5);
    expect(brute.budgetCost).toBe(3.4);
    expect(brute.attack).toBe(BRUTE_SETTINGS.attacks[0]);
    expect(brute.dropTable).toBe(BRUTE_SETTINGS.dropTable);
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
    expect(chooseEnemyDefinition(2, () => 0.999).kind).toBe("venomSpitter");
    expect(chooseEnemyDefinition(3, () => 0.999).kind).toBe("elite");
    expect(chooseEnemyDefinition(5, () => 0.999).kind).toBe("brute");
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
    expect(encounterBudgetForMapLevel(1)).toBe(20);
    expect(encounterBudgetForMapLevel(5)).toBe(38);
  });
});
