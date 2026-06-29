import { BRUTE_SETTINGS } from "./assets/enemies/brute/bruteAsset";
import { ELITE_ENEMY_SETTINGS } from "./assets/enemies/eliteEnemy/eliteEnemyAsset";
import { LEAN_HUNTER_SETTINGS } from "./assets/enemies/leanHunter/leanHunterAsset";
import { VENOM_SPITTER_SETTINGS } from "./assets/enemies/venomSpitter/venomSpitterAsset";
import type { DropTable, EnemyAssetSettings, EnemyAttackDefinition, EnemySpawnWeightSettings } from "./assetSettings";
import type { Rng } from "./rng";

export type EnemyKind = "leanHunter" | "venomSpitter" | "elite" | "brute";

export type EnemyDefinition = {
  kind: EnemyKind;
  radius: number;
  unlockMapLevel: number;
  budgetCost: number;
  spawnWeight: (mapLevel: number) => number;
  health: (enemyLevel: number) => number;
  speed: (enemyLevel: number) => number;
  attackDamage: (enemyLevel: number) => number;
  xpReward: (enemyLevel: number) => number;
  attack: EnemyAttackDefinition;
  dropTable: DropTable;
};

const ENEMY_DIFFICULTY_TUNING = {
  healthMultiplier: 1.2,
  speedMultiplier: 1.375,
  speedLevelGrowthMultiplier: 1.5,
  damageMultiplier: 1.2,
} as const;

export const ENEMY_DEFINITIONS: EnemyDefinition[] = [
  {
    kind: "leanHunter",
    radius: LEAN_HUNTER_SETTINGS.collision.radius,
    unlockMapLevel: 1,
    budgetCost: 1,
    spawnWeight: spawnWeightFromSettings(LEAN_HUNTER_SETTINGS.spawnWeight, 1),
    health: (enemyLevel) =>
      scaleEnemyHealth(LEAN_HUNTER_SETTINGS.health.base + enemyLevel * LEAN_HUNTER_SETTINGS.health.levelGrowth),
    speed: (enemyLevel) =>
      scaleEnemySpeed(
        LEAN_HUNTER_SETTINGS.movement.speed,
        LEAN_HUNTER_SETTINGS.movement.levelSpeedGrowth,
        enemyLevel,
      ),
    attackDamage: (enemyLevel) => scaledAttackDamage(LEAN_HUNTER_SETTINGS, enemyLevel, 3),
    xpReward: (enemyLevel) => Math.round(6 + enemyLevel * 1.5),
    attack: primaryEnemyAttack(LEAN_HUNTER_SETTINGS),
    dropTable: LEAN_HUNTER_SETTINGS.dropTable,
  },
  {
    kind: "venomSpitter",
    radius: VENOM_SPITTER_SETTINGS.collision.radius,
    unlockMapLevel: 2,
    budgetCost: 1.35,
    spawnWeight: spawnWeightFromSettings(VENOM_SPITTER_SETTINGS.spawnWeight, 2),
    health: (enemyLevel) =>
      scaleEnemyHealth(VENOM_SPITTER_SETTINGS.health.base + enemyLevel * VENOM_SPITTER_SETTINGS.health.levelGrowth),
    speed: (enemyLevel) =>
      scaleEnemySpeed(
        VENOM_SPITTER_SETTINGS.movement.speed,
        VENOM_SPITTER_SETTINGS.movement.levelSpeedGrowth,
        enemyLevel,
      ),
    attackDamage: (enemyLevel) => scaledAttackDamage(VENOM_SPITTER_SETTINGS, enemyLevel, 2),
    xpReward: (enemyLevel) => Math.round(10 + enemyLevel * 2.2),
    attack: primaryEnemyAttack(VENOM_SPITTER_SETTINGS),
    dropTable: VENOM_SPITTER_SETTINGS.dropTable,
  },
  {
    kind: "elite",
    radius: ELITE_ENEMY_SETTINGS.collision.radius,
    unlockMapLevel: 3,
    budgetCost: 2.4,
    spawnWeight: spawnWeightFromSettings(ELITE_ENEMY_SETTINGS.spawnWeight, 3),
    health: (enemyLevel) =>
      scaleEnemyHealth(ELITE_ENEMY_SETTINGS.health.base + enemyLevel * ELITE_ENEMY_SETTINGS.health.levelGrowth),
    speed: (enemyLevel) =>
      scaleEnemySpeed(
        ELITE_ENEMY_SETTINGS.movement.speed,
        ELITE_ENEMY_SETTINGS.movement.levelSpeedGrowth,
        enemyLevel,
      ),
    attackDamage: (enemyLevel) => scaledAttackDamage(ELITE_ENEMY_SETTINGS, enemyLevel, 4),
    xpReward: (enemyLevel) => Math.round(14 + enemyLevel * 3),
    attack: primaryEnemyAttack(ELITE_ENEMY_SETTINGS),
    dropTable: ELITE_ENEMY_SETTINGS.dropTable,
  },
  {
    kind: "brute",
    radius: BRUTE_SETTINGS.collision.radius,
    unlockMapLevel: 5,
    budgetCost: 3.4,
    spawnWeight: spawnWeightFromSettings(BRUTE_SETTINGS.spawnWeight, 5),
    health: (enemyLevel) =>
      scaleEnemyHealth(BRUTE_SETTINGS.health.base + enemyLevel * BRUTE_SETTINGS.health.levelGrowth),
    speed: (enemyLevel) =>
      scaleEnemySpeed(BRUTE_SETTINGS.movement.speed, BRUTE_SETTINGS.movement.levelSpeedGrowth, enemyLevel),
    attackDamage: (enemyLevel) => scaledAttackDamage(BRUTE_SETTINGS, enemyLevel, 6),
    xpReward: (enemyLevel) => Math.round(24 + enemyLevel * 4.2),
    attack: primaryEnemyAttack(BRUTE_SETTINGS),
    dropTable: BRUTE_SETTINGS.dropTable,
  },
];

export function chooseEnemyDefinition(
  mapLevel: number,
  rng: () => number = Math.random,
  options: { maxBudgetCost?: number } = {},
): EnemyDefinition {
  const definitions = ENEMY_DEFINITIONS.filter(
    (definition) => options.maxBudgetCost === undefined || definition.budgetCost <= options.maxBudgetCost,
  );
  const totalWeight = definitions.reduce((sum, definition) => sum + definition.spawnWeight(mapLevel), 0);
  let roll = rng() * totalWeight;

  for (const definition of definitions) {
    roll -= definition.spawnWeight(mapLevel);
    if (roll <= 0) return definition;
  }

  return definitions[0] ?? ENEMY_DEFINITIONS[0];
}

export function enemyLevelForMapLevel(mapLevel: number, rng: Rng = Math.random): number {
  const roll = rng();
  if (roll < 0.2) return Math.max(1, mapLevel - 1);
  if (roll < 0.95) return Math.max(1, mapLevel);
  return Math.max(1, mapLevel + 1);
}

export function encounterBudgetForMapLevel(mapLevel: number): number {
  return Math.round((10 + mapLevel * 3) * 1.5);
}

function primaryEnemyAttack(settings: EnemyAssetSettings): EnemyAttackDefinition {
  const melee = settings.attacks.find((attack) => attack.kind === "melee");
  return melee ?? settings.attacks[0];
}

function scaledAttackDamage(settings: EnemyAssetSettings, enemyLevel: number, levelGrowth: number): number {
  return Math.round(
    (primaryEnemyAttack(settings).damage + enemyLevel * levelGrowth) * ENEMY_DIFFICULTY_TUNING.damageMultiplier,
  );
}

function spawnWeightFromSettings(settings: EnemySpawnWeightSettings, unlockMapLevel: number): (mapLevel: number) => number {
  return (mapLevel) => {
    if (mapLevel < unlockMapLevel) return 0;
    const unlockedLevel = mapLevel - unlockMapLevel + 1;
    const scaled = settings.base + unlockedLevel * settings.levelGrowth;
    const withMin = settings.min === undefined ? scaled : Math.max(settings.min, scaled);
    return settings.max === undefined ? withMin : Math.min(settings.max, withMin);
  };
}

function scaleEnemyHealth(value: number): number {
  return Math.round(value * ENEMY_DIFFICULTY_TUNING.healthMultiplier);
}

function scaleEnemySpeed(base: number, levelGrowth: number, enemyLevel: number): number {
  return (
    (base + enemyLevel * levelGrowth * ENEMY_DIFFICULTY_TUNING.speedLevelGrowthMultiplier) *
    ENEMY_DIFFICULTY_TUNING.speedMultiplier
  );
}
