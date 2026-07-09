import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { DropTable } from "./assetSettings";
import type { CollisionBody2D } from "./collision";
import { EventQueue } from "./eventQueue";
import { PickupSystem } from "./pickupSystem";
import type { ResourceKind } from "./resourceTypes";

describe("PickupSystem", () => {
  it("doubles ammo received from ammo pickups", () => {
    const { events, pickups } = setupPickupSystem();

    pickups.maybeDropPickup(new THREE.Vector3(0, 0, 0), dropTable("ammo", 12));
    pickups.update(0);

    expect(events.drain()).toEqual([{ type: "pickupCollected", kind: "ammo", amount: 24 }]);
  });

  it("keeps non-ammo pickup amounts unchanged", () => {
    const { events, pickups } = setupPickupSystem();

    pickups.maybeDropPickup(new THREE.Vector3(0, 0, 0), dropTable("health", 12));
    pickups.update(0);

    expect(events.drain()).toEqual([{ type: "pickupCollected", kind: "health", amount: 12 }]);
  });
});

function setupPickupSystem() {
  const events = new EventQueue();
  const playerCollisionBody: CollisionBody2D = {
    position: new THREE.Vector3(0, 0, 0),
    radius: 0.5,
    collisionLayer: 1,
  };
  const pickups = new PickupSystem(events, playerCollisionBody, () => 1, () => 0);

  return { events, pickups };
}

function dropTable(kind: ResourceKind, amount: number): DropTable {
  return {
    chance: 1,
    entries: [{ kind, weight: 1, amount }],
  };
}
