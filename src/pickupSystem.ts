import * as THREE from "three";
import { AMMO_PICKUP_SETTINGS } from "./assets/pickups/ammoPickup/ammoPickupAsset";
import { ENERGY_PICKUP_SETTINGS } from "./assets/pickups/energyPickup/energyPickupAsset";
import { HEALTH_PICKUP_SETTINGS } from "./assets/pickups/healthPickup/healthPickupAsset";
import type { DropTable } from "./assetSettings";
import { DROP_BALANCE, EFFECT_BALANCE } from "./balance";
import { overlaps2D, type CollisionBody2D, type CollisionLayer } from "./collision";
import { disposeMeshGeometry } from "./entityLifecycle";
import type { EventQueue } from "./eventQueue";
import type { GameScene } from "./scene";
import type { Pickup, PickupDraft, PickupView, ResourceKind } from "./types";

export class PickupSystem {
  private readonly pickups: Pickup[] = [];
  private readonly pickupViews = new Map<number, PickupView>();
  private nextPickupId = 1;

  constructor(
    private readonly world: GameScene,
    private readonly events: EventQueue,
    private readonly playerCollisionBody: CollisionBody2D,
    private readonly getCollisionLayer: () => CollisionLayer,
  ) {}

  get count(): number {
    return this.pickups.length;
  }

  maybeDropPickup(position: THREE.Vector3, dropTable: DropTable): void {
    const entry = chooseDropEntry(dropTable);
    if (!entry) return;

    const { kind, amount } = entry;
    const settings =
      kind === "health" ? HEALTH_PICKUP_SETTINGS : kind === "ammo" ? AMMO_PICKUP_SETTINGS : ENERGY_PICKUP_SETTINGS;
    const mesh = this.world.createPickupAsset(kind).root;
    mesh.position.copy(position);
    mesh.position.y = 0.45;
    this.world.scene.add(mesh);
    this.addPickup(
      {
        position: position.clone(),
        kind,
        collisionLayer: this.getCollisionLayer(),
        amount,
        radius: settings.collision.radius,
        life: settings.lifetime ?? DROP_BALANCE.pickupLife,
      },
      mesh,
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
    for (const pickup of this.pickups.splice(0)) {
      this.disposePickupView(pickup.id);
    }
  }

  private addPickup(pickup: PickupDraft, mesh: THREE.Mesh): void {
    const id = this.nextPickupId;
    this.nextPickupId += 1;
    this.pickups.push({ id, ...pickup });
    this.pickupViews.set(id, { id, mesh });
  }

  private syncPickupViews(dt: number): void {
    for (const pickup of this.pickups) {
      const view = this.pickupViews.get(pickup.id);
      if (!view) continue;
      view.mesh.position.copy(pickup.position);
      view.mesh.position.y = 0.45 + Math.sin(performance.now() * EFFECT_BALANCE.pickupBobSpeed + view.mesh.id) * EFFECT_BALANCE.pickupBobHeight;
      view.mesh.rotation.y += dt * EFFECT_BALANCE.pickupSpinSpeed;
    }
  }

  private disposePickupView(id: number): void {
    const view = this.pickupViews.get(id);
    if (!view) return;
    this.world.scene.remove(view.mesh);
    disposeMeshGeometry(view.mesh);
    this.pickupViews.delete(id);
  }
}

function chooseDropEntry(dropTable: DropTable): { kind: ResourceKind; amount: number } | null {
  if (Math.random() > dropTable.chance) return null;

  const totalWeight = dropTable.entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) return null;

  let roll = Math.random() * totalWeight;
  for (const entry of dropTable.entries) {
    roll -= entry.weight;
    if (roll <= 0) {
      return { kind: entry.kind, amount: entry.amount };
    }
  }

  const fallback = dropTable.entries[0];
  return fallback ? { kind: fallback.kind, amount: fallback.amount } : null;
}
