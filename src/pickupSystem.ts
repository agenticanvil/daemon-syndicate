import * as THREE from "three";
import type { DropTable } from "./assetSettings";
import { overlaps2D, type CollisionBody2D, type CollisionLayer } from "./collision";
import type { EventQueue } from "./eventQueue";
import type { Rng } from "./rng";
import type { ResourceKind } from "./resourceTypes";
import type { Pickup, PickupDraft } from "./pickupTypes";
import type { VectorSnapshot } from "./vectorTypes";

const PICKUP_SETTINGS = {
  health: { collision: { radius: 0.62 } },
  ammo: { collision: { radius: 0.62 } },
  energy: { collision: { radius: 0.62 } },
} as const satisfies Record<ResourceKind, { collision: { radius: number } }>;

const PICKUP_AMOUNT_MULTIPLIER = {
  health: 1,
  ammo: 2,
  energy: 1,
} as const satisfies Record<ResourceKind, number>;

export type PickupSystemSnapshot = Array<{
  id: number;
  position: VectorSnapshot;
  kind: ResourceKind;
  collisionLayer: CollisionLayer;
  amount: number;
  radius: number;
}>;

export class PickupSystem {
  private readonly pickups: Pickup[] = [];
  private nextPickupId = 1;

  constructor(
    private readonly events: EventQueue,
    private readonly playerCollisionBody: CollisionBody2D,
    private readonly getCollisionLayer: () => CollisionLayer,
    private readonly rng: Rng = Math.random,
  ) {}

  get count(): number {
    return this.pickups.length;
  }

  get all(): readonly Pickup[] {
    return this.pickups;
  }

  maybeDropPickup(position: THREE.Vector3, dropTable: DropTable): void {
    const entry = chooseDropEntry(dropTable, this.rng);
    if (!entry) return;

    const { kind, amount } = entry;
    const settings = PICKUP_SETTINGS[kind];
    this.addPickup(
      {
        position: position.clone(),
        kind,
        collisionLayer: this.getCollisionLayer(),
        amount: amount * PICKUP_AMOUNT_MULTIPLIER[kind],
        radius: settings.collision.radius,
      },
    );
  }

  update(_dt: number): void {
    for (let i = this.pickups.length - 1; i >= 0; i -= 1) {
      const pickup = this.pickups[i];
      if (overlaps2D(pickup, this.playerCollisionBody)) {
        this.events.emit({ type: "pickupCollected", kind: pickup.kind, amount: pickup.amount });
        this.pickups.splice(i, 1);
      }
    }
  }

  clear(): void {
    this.pickups.length = 0;
  }

  snapshot(): PickupSystemSnapshot {
    return this.pickups.map((pickup) => ({
      id: pickup.id,
      position: vectorSnapshot(pickup.position),
      kind: pickup.kind,
      collisionLayer: pickup.collisionLayer,
      amount: pickup.amount,
      radius: pickup.radius,
    }));
  }

  private addPickup(pickup: PickupDraft): void {
    const id = this.nextPickupId;
    this.nextPickupId += 1;
    this.pickups.push({ id, ...pickup });
  }
}

function chooseDropEntry(dropTable: DropTable, rng: Rng): { kind: ResourceKind; amount: number } | null {
  if (rng() > dropTable.chance) return null;

  const totalWeight = dropTable.entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) return null;

  let roll = rng() * totalWeight;
  for (const entry of dropTable.entries) {
    roll -= entry.weight;
    if (roll <= 0) {
      return { kind: entry.kind, amount: entry.amount };
    }
  }

  const fallback = dropTable.entries[0];
  return fallback ? { kind: fallback.kind, amount: fallback.amount } : null;
}

function vectorSnapshot(vector: THREE.Vector3): VectorSnapshot {
  return { x: vector.x, y: vector.y, z: vector.z };
}
