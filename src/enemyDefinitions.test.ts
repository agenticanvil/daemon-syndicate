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

    expect(leanHunter.health(3)).toBe(LEAN_HUNTER_SETTINGS.health + 3 * 5);
    expect(leanHunter.speed(3)).toBeCloseTo(2.8 + 3 * 0.07);
    expect(leanHunter.radius).toBe(LEAN_HUNTER_SETTINGS.collision.radius);

    expect(elite.health(3)).toBe(ELITE_ENEMY_SETTINGS.health + 3 * 8);
    expect(elite.speed(3)).toBeCloseTo(2.2 + 3 * 0.05);
    expect(elite.radius).toBe(ELITE_ENEMY_SETTINGS.collision.radius);
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
