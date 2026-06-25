import * as THREE from "three";
import { AMMO_PICKUP_SETTINGS } from "./assets/pickups/ammoPickup/ammoPickupAsset";
import { ENERGY_PICKUP_SETTINGS } from "./assets/pickups/energyPickup/energyPickupAsset";
import { HEALTH_PICKUP_SETTINGS } from "./assets/pickups/healthPickup/healthPickupAsset";
import { DROP_BALANCE, EFFECT_BALANCE } from "./balance";
import { overlaps2D, type CollisionBody2D, type CollisionLayer } from "./collision";
import { disposeMeshGeometry } from "./entityLifecycle";
import type { GameScene } from "./scene";
import type { Pickup, PlayerResources, ResourceKind } from "./types";

export class PickupSystem {
  private readonly pickups: Pickup[] = [];

  constructor(
    private readonly world: GameScene,
    private readonly playerCollisionBody: CollisionBody2D,
    private readonly getCollisionLayer: () => CollisionLayer,
    private readonly resources: PlayerResources,
    private readonly maxResources: PlayerResources,
  ) {}

  get count(): number {
    return this.pickups.length;
  }

  maybeDropPickup(position: THREE.Vector3): void {
    const roll = Math.random();
    if (roll > DROP_BALANCE.dropChance) return;

    const kind: ResourceKind = roll < DROP_BALANCE.healthRoll ? "health" : roll < DROP_BALANCE.ammoRoll ? "ammo" : "energy";
    const amount = DROP_BALANCE.amount[kind];
    const settings =
      kind === "health" ? HEALTH_PICKUP_SETTINGS : kind === "ammo" ? AMMO_PICKUP_SETTINGS : ENERGY_PICKUP_SETTINGS;
    const mesh = this.world.createPickupAsset(kind).root;
    mesh.position.copy(position);
    mesh.position.y = 0.45;
    this.world.scene.add(mesh);
    this.pickups.push({
      mesh,
      kind,
      collisionLayer: this.getCollisionLayer(),
      amount,
      radius: settings.collision.radius,
      life: DROP_BALANCE.pickupLife,
    });
  }

  update(dt: number): void {
    for (const pickup of this.pickups) {
      pickup.life -= dt;
      pickup.mesh.rotation.y += dt * EFFECT_BALANCE.pickupSpinSpeed;
      pickup.mesh.position.y =
        0.45 + Math.sin(performance.now() * EFFECT_BALANCE.pickupBobSpeed + pickup.mesh.id) * EFFECT_BALANCE.pickupBobHeight;

      if (overlaps2D(pickup, this.playerCollisionBody)) {
        this.resources[pickup.kind] = Math.min(
          this.maxResources[pickup.kind],
          this.resources[pickup.kind] + pickup.amount,
        );
        pickup.life = 0;
      }
    }

    for (let i = this.pickups.length - 1; i >= 0; i -= 1) {
      const pickup = this.pickups[i];
      if (pickup.life <= 0) {
        this.world.scene.remove(pickup.mesh);
        disposeMeshGeometry(pickup.mesh);
        this.pickups.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const pickup of this.pickups.splice(0)) {
      this.world.scene.remove(pickup.mesh);
      disposeMeshGeometry(pickup.mesh);
    }
  }
}
