import type * as THREE from "three";

export type GameEffect =
  | { type: "damageText"; position: THREE.Vector3; text: string }
  | { type: "nova"; position: THREE.Vector3 }
  | { type: "projectileImpact"; position: THREE.Vector3; incomingVelocity: THREE.Vector3 };
