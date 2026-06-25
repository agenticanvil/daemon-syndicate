import * as THREE from "three";
import type { CollisionLayer } from "./collision";

export type ResourceKind = "health" | "ammo" | "energy";

export type PlayerResources = {
  health: number;
  ammo: number;
  energy: number;
};

export type Enemy = {
  mesh: THREE.Object3D;
  updateRig?: (animation: "idle" | "walk" | "melee" | "death", dt: number) => void;
  collisionLayer: CollisionLayer;
  hp: number;
  speed: number;
  radius: number;
  attackTimer: number;
  deathTimer?: number;
};

export type Projectile = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  collisionLayer: CollisionLayer;
  life: number;
  damage: number;
  radius: number;
};

export type Pickup = {
  mesh: THREE.Mesh;
  kind: ResourceKind;
  collisionLayer: CollisionLayer;
  amount: number;
  radius: number;
  life: number;
};

export type DamageText = {
  el: HTMLDivElement;
  world: THREE.Vector3;
  life: number;
};
