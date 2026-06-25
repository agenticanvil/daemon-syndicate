import * as THREE from "three";

export type CollisionLayer = string | number;

export type CollisionBody2D = {
  position: THREE.Vector3;
  radius: number;
  collisionLayer: CollisionLayer;
};

export type ObjectCollisionBody2D = {
  mesh: THREE.Object3D;
  radius: number;
  collisionLayer: CollisionLayer;
};

type CollisionBody2DLike = CollisionBody2D | ObjectCollisionBody2D;
type CollisionPoint2DLike =
  | Pick<CollisionBody2D, "position" | "collisionLayer">
  | Pick<ObjectCollisionBody2D, "mesh" | "collisionLayer">;

export function distanceSq2D(a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function distance2D(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.sqrt(distanceSq2D(a, b));
}

export function overlaps2D(a: CollisionBody2DLike, b: CollisionBody2DLike): boolean {
  if (a.collisionLayer !== b.collisionLayer) return false;
  const radius = a.radius + b.radius;
  return distanceSq2D(positionOf(a), positionOf(b)) <= radius * radius;
}

export function withinRadius2D(
  a: CollisionPoint2DLike,
  b: CollisionPoint2DLike,
  radius: number,
): boolean {
  if (a.collisionLayer !== b.collisionLayer) return false;
  return distanceSq2D(positionOf(a), positionOf(b)) <= radius * radius;
}

function positionOf(body: CollisionPoint2DLike): THREE.Vector3 {
  return "position" in body ? body.position : body.mesh.position;
}
