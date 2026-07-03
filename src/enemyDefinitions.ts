import { ENEMY_CONTENT, type EnemyKind } from "./enemyContent";
import type { DropTable, EnemyAssetSettings, EnemyAttackDefinition, EnemySpawnWeightSettings } from "./assetSettings";
import type { Rng } from "./rng";

export type { EnemyKind };

export type EnemyDefinition = {
  kind: EnemyKind;
  radius: number;
  unlockMapDepth: number;
  budgetCost: number;
  spawnWeight: (mapDepth: number) => number;
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

export const ENEMY_DEFINITIONS: EnemyDefinition[] = ENEMY_CONTENT.map((content) =>
  createEnemyDefinition(content.kind, content.settings),
);

export function chooseEnemyDefinition(
  mapDepth: number,
  rng: () => number = Math.random,
  options: { maxBudgetCost?: number } = {},
): EnemyDefinition {
  const definitions = ENEMY_DEFINITIONS.filter(
    (definition) => options.maxBudgetCost === undefined || definition.budgetCost <= options.maxBudgetCost,
  );
  const totalWeight = definitions.reduce((sum, definition) => sum + definition.spawnWeight(mapDepth), 0);
  let roll = rng() * totalWeight;

  for (const definition of definitions) {
    roll -= definition.spawnWeight(mapDepth);
    if (roll <= 0) return definition;
  }

  return definitions[0] ?? ENEMY_DEFINITIONS[0];
}

export function enemyLevelForMapDepth(mapDepth: number, rng: Rng = Math.random): number {
  const roll = rng();
  if (roll < 0.2) return Math.max(1, mapDepth - 1);
  if (roll < 0.95) return Math.max(1, mapDepth);
  return Math.max(1, mapDepth + 1);
}

export function encounterBudgetForMapDepth(mapDepth: number): number {
  return Math.round((10 + mapDepth * 3) * 1.5);
}

function primaryEnemyAttack(settings: EnemyAssetSettings): EnemyAttackDefinition {
  const melee = settings.attacks.find((attack) => attack.kind === "melee");
  return melee ?? settings.attacks[0];
}

function createEnemyDefinition(kind: EnemyKind, settings: EnemyAssetSettings): EnemyDefinition {
  return {
    kind,
    radius: settings.collision.radius,
    unlockMapDepth: settings.gameplay.unlockMapDepth,
    budgetCost: settings.gameplay.budgetCost,
    spawnWeight: spawnWeightFromSettings(settings.spawnWeight, settings.gameplay.unlockMapDepth),
    health: (enemyLevel) => scaleEnemyHealth(settings.health.base + enemyLevel * settings.health.levelGrowth),
    speed: (enemyLevel) =>
      scaleEnemySpeed(settings.movement.speed, settings.movement.levelSpeedGrowth, enemyLevel),
    attackDamage: (enemyLevel) => scaledAttackDamage(settings, enemyLevel),
    xpReward: (enemyLevel) =>
      Math.round(settings.gameplay.xpReward.base + enemyLevel * settings.gameplay.xpReward.levelGrowth),
    attack: primaryEnemyAttack(settings),
    dropTable: settings.dropTable,
  };
}

function scaledAttackDamage(settings: EnemyAssetSettings, enemyLevel: number): number {
  return Math.round(
    (primaryEnemyAttack(settings).damage + enemyLevel * settings.gameplay.attackDamageLevelGrowth) *
      ENEMY_DIFFICULTY_TUNING.damageMultiplier,
  );
}

function spawnWeightFromSettings(settings: EnemySpawnWeightSettings, unlockMapDepth: number): (mapDepth: number) => number {
  return (mapDepth) => {
    if (mapDepth < unlockMapDepth) return 0;
    const unlockedLevel = mapDepth - unlockMapDepth + 1;
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
