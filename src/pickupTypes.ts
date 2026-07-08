import * as THREE from "three";
import type { CollisionLayer } from "./collision";
import type { ResourceKind } from "./resourceTypes";

export type Pickup = {
  id: number;
  position: THREE.Vector3;
  kind: ResourceKind;
  collisionLayer: CollisionLayer;
  amount: number;
  radius: number;
};

export type PickupDraft = Omit<Pickup, "id">;
