import * as THREE from "three";
import type { DropTable, EnemyAttackDefinition } from "./assetSettings";
import type { CollisionLayer } from "./collision";
import type { EnemyKind } from "./enemyDefinitions";

export type EnemyAnimation = "idle" | "walk" | "melee" | "death";

export type Enemy = {
  id: number;
  kind: EnemyKind;
  enemyLevel: number;
  position: THREE.Vector3;
  facingYaw: number;
  collisionLayer: CollisionLayer;
  health: number;
  speed: number;
  xpReward: number;
  radius: number;
  attack: EnemyAttackDefinition;
  dropTable: DropTable;
  attackTimer: number;
  attackWindupTimer?: number;
  attackWindupDirection?: THREE.Vector3;
  deathTimer?: number;
  path?: string[];
  pathTarget?: string;
  pathRefreshTimer?: number;
  animation: EnemyAnimation;
};

export type EnemyDraft = Omit<Enemy, "id">;
