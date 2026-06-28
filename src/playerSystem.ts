import * as THREE from "three";
import { PLAYER_BALANCE } from "./balance";
import type { CollisionBody2D, CollisionLayer } from "./collision";
import { PLAYER_MAX } from "./constants";
import type { GameplayView } from "./gameView";
import type { LevelData } from "./level";
import { moveOnWalkableLevel } from "./movement";
import type { PlayerCommand } from "./playerCommand";
import { hasStatusEffect, setStatusEffect, tickStatusEffects, type StatusEffect } from "./statusEffects";
import type { PlayerResources, ResourceKind } from "./types";

const PLAYER_MODEL_FORWARD_OFFSET = Math.PI;
const PLAYER_BASE_COLOR = 0x9bf0df;
const PLAYER_FLASH_COLOR = 0xffffff;
const PLAYER_LOW_HEALTH_COLOR = 0xff7474;

export class PlayerSystem {
  readonly maxResources: PlayerResources = { ...PLAYER_MAX };
  readonly resources: PlayerResources = { ...PLAYER_MAX };
  readonly collisionBody: CollisionBody2D;

  private readonly movementInput = new THREE.Vector3();
  private readonly statusEffects: StatusEffect[] = [];
  private moving = false;

  constructor(
    private readonly view: GameplayView,
    private readonly getLevel: () => LevelData,
  ) {
    this.collisionBody = {
      position: this.view.player.position,
      radius: PLAYER_BALANCE.radius,
      collisionLayer: 0,
    };
  }

  get isMoving(): boolean {
    return this.moving;
  }

  reset(position: THREE.Vector3, collisionLayer: CollisionLayer): void {
    this.view.player.position.copy(position);
    this.collisionBody.collisionLayer = collisionLayer;
    this.resources.health = this.maxResources.health;
    this.resources.ammo = this.maxResources.ammo;
    this.resources.energy = this.maxResources.energy;
    this.statusEffects.length = 0;
    this.moving = false;
    this.view.player.setBodyColor(PLAYER_BASE_COLOR);
  }

  moveTo(position: THREE.Vector3, collisionLayer: CollisionLayer): void {
    this.view.player.position.copy(position);
    this.collisionBody.collisionLayer = collisionLayer;
    this.moving = false;
  }

  setCollisionLayer(collisionLayer: CollisionLayer): void {
    this.collisionBody.collisionLayer = collisionLayer;
  }

  updateTimers(dt: number): void {
    tickStatusEffects(this.statusEffects, dt);
    this.view.player.lerpBodyColor(this.targetBodyColor(), dt * 10);
  }

  regenerate(dt: number): void {
    this.resources.energy = Math.min(
      this.maxResources.energy,
      this.resources.energy + PLAYER_BALANCE.energyRegenPerSecond * dt,
    );
  }

  applyMovement(command: PlayerCommand, dt: number): void {
    const input = this.movementInput.copy(command.movement);
    this.moving = input.lengthSq() > 0;

    if (this.moving) {
      input.normalize();
      moveOnWalkableLevel(this.getLevel(), this.view.player.position, input, PLAYER_BALANCE.speed * dt);
    }
  }

  updateAim(aimWorld: THREE.Vector3): void {
    const aim = aimWorld.clone().sub(this.view.player.position).setY(0);
    if (aim.lengthSq() > 0.01) {
      this.view.player.rotation.y = Math.atan2(aim.x, aim.z) + PLAYER_MODEL_FORWARD_OFFSET;
    }
  }

  updateRig(dt: number): void {
    this.view.player.updateRig(
      {
        moving: this.moving,
        moveSpeed: PLAYER_BALANCE.speed,
        damaged: this.hasStatus("invulnerable"),
        lowHealth: this.resources.health <= PLAYER_BALANCE.lowHealthThreshold,
      },
      dt,
    );
  }

  damage(): boolean {
    this.setStatus("invulnerable", PLAYER_BALANCE.invulnerabilityDuration);
    this.view.player.setBodyColor(
      this.resources.health <= PLAYER_BALANCE.lowHealthThreshold ? PLAYER_LOW_HEALTH_COLOR : PLAYER_FLASH_COLOR,
    );
    return this.resources.health <= 0;
  }

  grantResource(kind: ResourceKind, amount: number): void {
    this.resources[kind] = Math.min(this.maxResources[kind], this.resources[kind] + amount);
  }

  hasStatus(kind: StatusEffect["kind"]): boolean {
    return hasStatusEffect(this.statusEffects, kind);
  }

  snapshot(): object {
    return {
      position: vectorSnapshot(this.view.player.position),
      rotationY: this.view.player.rotation.y,
      collisionLayer: this.collisionBody.collisionLayer,
      resources: { ...this.resources },
      maxResources: { ...this.maxResources },
      statusEffects: this.statusEffects.map((status) => ({ ...status })),
      moving: this.moving,
    };
  }

  private setStatus(kind: StatusEffect["kind"], remaining: number): void {
    setStatusEffect(this.statusEffects, { kind, remaining });
  }

  private targetBodyColor(): number {
    return this.resources.health <= PLAYER_BALANCE.lowHealthThreshold ? PLAYER_LOW_HEALTH_COLOR : PLAYER_BASE_COLOR;
  }
}

function vectorSnapshot(vector: THREE.Vector3): { x: number; y: number; z: number } {
  return { x: vector.x, y: vector.y, z: vector.z };
}
