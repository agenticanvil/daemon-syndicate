import { ELITE_ENEMY_SETTINGS } from "./assets/enemies/eliteEnemy/eliteEnemyAsset";
import { LEAN_HUNTER_SETTINGS } from "./assets/enemies/leanHunterAsset";
import type { DropTable, EnemyAssetSettings, EnemyAttackDefinition, EnemySpawnWeightSettings } from "./assetSettings";

export type EnemyKind = "leanHunter" | "elite";

export type EnemyDefinition = {
  kind: EnemyKind;
  radius: number;
  spawnWeight: (wave: number) => number;
  health: (wave: number) => number;
  speed: (wave: number) => number;
  attack: EnemyAttackDefinition;
  dropTable: DropTable;
};

export const ENEMY_DEFINITIONS: EnemyDefinition[] = [
  {
    kind: "leanHunter",
    radius: LEAN_HUNTER_SETTINGS.collision.radius,
    spawnWeight: spawnWeightFromSettings(LEAN_HUNTER_SETTINGS.spawnWeight),
    health: (wave) => LEAN_HUNTER_SETTINGS.health.base + wave * LEAN_HUNTER_SETTINGS.health.waveGrowth,
    speed: (wave) => LEAN_HUNTER_SETTINGS.movement.speed + wave * LEAN_HUNTER_SETTINGS.movement.waveSpeedGrowth,
    attack: primaryEnemyAttack(LEAN_HUNTER_SETTINGS),
    dropTable: LEAN_HUNTER_SETTINGS.dropTable,
  },
  {
    kind: "elite",
    radius: ELITE_ENEMY_SETTINGS.collision.radius,
    spawnWeight: spawnWeightFromSettings(ELITE_ENEMY_SETTINGS.spawnWeight),
    health: (wave) => ELITE_ENEMY_SETTINGS.health.base + wave * ELITE_ENEMY_SETTINGS.health.waveGrowth,
    speed: (wave) => ELITE_ENEMY_SETTINGS.movement.speed + wave * ELITE_ENEMY_SETTINGS.movement.waveSpeedGrowth,
    attack: primaryEnemyAttack(ELITE_ENEMY_SETTINGS),
    dropTable: ELITE_ENEMY_SETTINGS.dropTable,
  },
];

export function chooseEnemyDefinition(wave: number, rng: () => number = Math.random): EnemyDefinition {
  const totalWeight = ENEMY_DEFINITIONS.reduce((sum, definition) => sum + definition.spawnWeight(wave), 0);
  let roll = rng() * totalWeight;

  for (const definition of ENEMY_DEFINITIONS) {
    roll -= definition.spawnWeight(wave);
    if (roll <= 0) return definition;
  }

  return ENEMY_DEFINITIONS[0];
}

function primaryEnemyAttack(settings: EnemyAssetSettings): EnemyAttackDefinition {
  const melee = settings.attacks.find((attack) => attack.kind === "melee");
  return melee ?? settings.attacks[0];
}

function spawnWeightFromSettings(settings: EnemySpawnWeightSettings): (wave: number) => number {
  return (wave) => {
    const scaled = settings.base + wave * settings.waveGrowth;
    const withMin = settings.min === undefined ? scaled : Math.max(settings.min, scaled);
    return settings.max === undefined ? withMin : Math.min(settings.max, withMin);
  };
}
