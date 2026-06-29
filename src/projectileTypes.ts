import * as THREE from "three";
import type { CollisionLayer } from "./collision";

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

export type EnemyProjectile = {
  id: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  collisionLayer: CollisionLayer;
  life: number;
  damage: number;
  radius: number;
};

export type EnemyProjectileDraft = Omit<EnemyProjectile, "id">;
