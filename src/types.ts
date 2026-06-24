import * as THREE from "three";

export type ResourceKind = "health" | "ammo" | "energy";

export type PlayerResources = {
  health: number;
  ammo: number;
  energy: number;
};

export type Enemy = {
  mesh: THREE.Mesh;
  hp: number;
  speed: number;
  radius: number;
  attackTimer: number;
};

export type Projectile = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  damage: number;
  radius: number;
};

export type Pickup = {
  mesh: THREE.Mesh;
  kind: ResourceKind;
  amount: number;
  radius: number;
  life: number;
};

export type DamageText = {
  el: HTMLDivElement;
  world: THREE.Vector3;
  life: number;
};
