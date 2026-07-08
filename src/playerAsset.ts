import type * as THREE from "three";

type PlayerAnimationState = {
  moving: boolean;
  moveSpeed: number;
  damaged: boolean;
  lowHealth: boolean;
};

export type WeaponAttachmentOptions = {
  debugSockets?: boolean;
};

export type PlayerRig = {
  root: THREE.Group;
  body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  handSocket: THREE.Object3D;
  setWeapon: (weapon: THREE.Object3D, options?: WeaponAttachmentOptions) => void;
  triggerFire: () => void;
  applyBasePose: () => void;
  update: (state: PlayerAnimationState, dt: number) => void;
};
