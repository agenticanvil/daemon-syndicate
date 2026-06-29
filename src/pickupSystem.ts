import * as THREE from "three";
import { AMMO_PICKUP_SETTINGS } from "./assets/pickups/ammoPickup/ammoPickupAsset";
import { ENERGY_PICKUP_SETTINGS } from "./assets/pickups/energyPickup/energyPickupAsset";
import { HEALTH_PICKUP_SETTINGS } from "./assets/pickups/healthPickup/healthPickupAsset";
import type { DropTable } from "./assetSettings";
import { DROP_BALANCE } from "./balance";
import { overlaps2D, type CollisionBody2D, type CollisionLayer } from "./collision";
import type { EventQueue } from "./eventQueue";
import type { GameplayView, PickupViewHandle } from "./gameView";
import type { Rng } from "./rng";
import type { Pickup, PickupDraft, ResourceKind, VectorSnapshot } from "./types";

export type PickupSystemSnapshot = Array<{
  id: number;
  position: VectorSnapshot;
  kind: ResourceKind;
  collisionLayer: CollisionLayer;
  amount: number;
  radius: number;
  life: number;
}>;

export class PickupSystem {
  private readonly pickups: Pickup[] = [];
  private readonly pickupViews = new Map<number, PickupViewHandle>();
  private nextPickupId = 1;

  constructor(
    private readonly view: GameplayView,
    private readonly events: EventQueue,
    private readonly playerCollisionBody: CollisionBody2D,
    private readonly getCollisionLayer: () => CollisionLayer,
    private readonly rng: Rng = Math.random,
  ) {}

  get count(): number {
    return this.pickups.length;
  }

  maybeDropPickup(position: THREE.Vector3, dropTable: DropTable): void {
    const entry = chooseDropEntry(dropTable, this.rng);
    if (!entry) return;

    const { kind, amount } = entry;
    const settings =
      kind === "health" ? HEALTH_PICKUP_SETTINGS : kind === "ammo" ? AMMO_PICKUP_SETTINGS : ENERGY_PICKUP_SETTINGS;
    this.addPickup(
      {
        position: position.clone(),
        kind,
        collisionLayer: this.getCollisionLayer(),
        amount,
        radius: settings.collision.radius,
        life: settings.lifetime ?? DROP_BALANCE.pickupLife,
      },
    );
  }

  update(dt: number): void {
    for (const pickup of this.pickups) {
      pickup.life -= dt;

      if (overlaps2D(pickup, this.playerCollisionBody)) {
        this.events.emit({ type: "pickupCollected", kind: pickup.kind, amount: pickup.amount });
        pickup.life = 0;
      }
    }

    for (let i = this.pickups.length - 1; i >= 0; i -= 1) {
      const pickup = this.pickups[i];
      if (pickup.life <= 0) {
        this.disposePickupView(pickup.id);
        this.pickups.splice(i, 1);
      }
    }

    this.syncPickupViews(dt);
  }

  clear(): void {
    for (const pickup of this.pickups) {
      this.disposePickupView(pickup.id);
    }
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
      life: pickup.life,
    }));
  }

  private addPickup(pickup: PickupDraft): void {
    const id = this.nextPickupId;
    this.nextPickupId += 1;
    const view = this.view.createPickupView(pickup.kind, pickup.position);
    this.pickups.push({ id, ...pickup });
    this.pickupViews.set(id, view);
  }

  private syncPickupViews(dt: number): void {
    for (const pickup of this.pickups) {
      const view = this.pickupViews.get(pickup.id);
      if (!view) continue;
      view.sync(pickup.position, dt);
    }
  }

  private disposePickupView(id: number): void {
    const view = this.pickupViews.get(id);
    if (!view) return;
    view.dispose();
    this.pickupViews.delete(id);
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
