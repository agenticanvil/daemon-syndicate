import type * as THREE from "three";

export type GameEffect =
  | { type: "damageText"; position: THREE.Vector3; text: string }
  | { type: "enemyHit"; enemyId: number; position: THREE.Vector3 }
  | { type: "enemyDeath"; position: THREE.Vector3 }
  | { type: "nova"; position: THREE.Vector3; radius: number }
  | { type: "projectileImpact"; position: THREE.Vector3; incomingVelocity: THREE.Vector3 }
  | { type: "playerDamaged"; amount: number };
