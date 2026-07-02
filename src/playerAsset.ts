import type * as THREE from "three";

type PlayerAnimationState = {
  moving: boolean;
  moveSpeed: number;
  damaged: boolean;
  lowHealth: boolean;
};

export type PlayerRig = {
  root: THREE.Group;
  body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  handSocket: THREE.Group;
  setWeapon: (weapon: THREE.Object3D) => void;
  triggerFire: () => void;
  applyBasePose: () => void;
  update: (state: PlayerAnimationState, dt: number) => void;
};
