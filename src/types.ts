import * as THREE from "three";
import type { DropTable, EnemyAttackDefinition } from "./assetSettings";
import type { CollisionLayer } from "./collision";
import type { EnemyKind } from "./enemyDefinitions";

export type EnemyAnimation = "idle" | "walk" | "melee" | "death";

export type ResourceKind = "health" | "ammo" | "energy";

export type PlayerResources = {
  health: number;
  ammo: number;
  energy: number;
};

export type Enemy = {
  id: number;
  kind: EnemyKind;
  enemyLevel: number;
  position: THREE.Vector3;
  facingYaw: number;
  collisionLayer: CollisionLayer;
  hp: number;
  speed: number;
  xpReward: number;
  radius: number;
  attack: EnemyAttackDefinition;
  dropTable: DropTable;
  attackTimer: number;
  deathTimer?: number;
  path?: string[];
  pathTarget?: string;
  pathRefreshTimer?: number;
};

export type EnemyDraft = Omit<Enemy, "id">;

export type EnemyView = {
  id: number;
  root: THREE.Object3D;
  height: number;
  updateRig?: (animation: EnemyAnimation, dt: number) => void;
  disposeMaterials: boolean;
};

export type Projectile = {
  id: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  collisionLayer: CollisionLayer;
  life: number;
  damage: number;
  radius: number;
  pierceRemaining?: number;
  hitEnemyIds?: Set<number>;
};

export type ProjectileDraft = Omit<Projectile, "id">;

export type ProjectileView = {
  id: number;
  mesh: THREE.Mesh;
};

export type Pickup = {
  id: number;
  position: THREE.Vector3;
  kind: ResourceKind;
  collisionLayer: CollisionLayer;
  amount: number;
  radius: number;
  life: number;
};

export type PickupDraft = Omit<Pickup, "id">;

export type PickupView = {
  id: number;
  mesh: THREE.Mesh;
};

export type DamageText = {
  el: HTMLDivElement;
  world: THREE.Vector3;
  life: number;
};
