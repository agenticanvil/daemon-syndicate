import type { ResourceKind } from "./resourceTypes";
import type { SoundId } from "./audio";

type CollisionSettings = {
  radius: number;
  height: number;
};

export type DropTable = {
  chance: number;
  entries: Array<{ kind: ResourceKind; weight: number; amount: number }>;
};

export type EnemyAttackDefinition = {
  kind: "melee" | "ranged";
  damage: number;
  cooldown: number;
  range: number;
  projectileSpeed?: number;
  projectileRadius?: number;
  windup?: number;
};

type EnemyHealthSettings = {
  base: number;
  levelGrowth: number;
};

export type EnemySpawnWeightSettings = {
  base: number;
  levelGrowth: number;
  min?: number;
  max?: number;
};

type EnemyGameplaySettings = {
  unlockMapDepth: number;
  budgetCost: number;
  attackDamageLevelGrowth: number;
  xpReward: {
    base: number;
    levelGrowth: number;
  };
};

export type EnemyAssetSettings = {
  kind: "enemy";
  gameplay: EnemyGameplaySettings;
  collision: CollisionSettings;
  health: EnemyHealthSettings;
  movement: {
    speed: number;
    levelSpeedGrowth: number;
    sound?: SoundId;
  };
  spawnWeight: EnemySpawnWeightSettings;
  attacks: EnemyAttackDefinition[];
  dropTable: DropTable;
};

export type PickupAssetSettings = {
  kind: "pickup";
  collision: CollisionSettings;
  resources: Partial<Record<ResourceKind, number>>;
  lifetime?: number;
};

type PlayerAssetSettings = {
  kind: "player";
  collision: CollisionSettings;
  health: number;
  movement?: {
    speed: number;
  };
};

type EnvironmentAssetSettings = {
  kind: "environment";
  collision: CollisionSettings;
};

export type AssetSettings = EnemyAssetSettings | PickupAssetSettings | PlayerAssetSettings | EnvironmentAssetSettings;
