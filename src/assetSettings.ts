import type { ResourceKind } from "./types";

export type CollisionSettings = {
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
  windup?: number;
};

export type EnemyHealthSettings = {
  base: number;
  waveGrowth: number;
};

export type EnemySpawnWeightSettings = {
  base: number;
  waveGrowth: number;
  min?: number;
  max?: number;
};

export type EnemyAssetSettings = {
  kind: "enemy";
  collision: CollisionSettings;
  health: EnemyHealthSettings;
  movement: {
    speed: number;
    waveSpeedGrowth: number;
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

export type PlayerAssetSettings = {
  kind: "player";
  collision: CollisionSettings;
  health: number;
  movement?: {
    speed: number;
  };
};

export type EnvironmentAssetSettings = {
  kind: "environment";
  collision: CollisionSettings;
};

export type AssetSettings = EnemyAssetSettings | PickupAssetSettings | PlayerAssetSettings | EnvironmentAssetSettings;
