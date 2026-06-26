import * as THREE from "three";
import { PLAYER_BALANCE } from "./balance";
import type { CollisionBody2D, CollisionLayer } from "./collision";
import { PLAYER_MAX } from "./constants";
import type { InputState } from "./inputState";
import type { LevelData } from "./level";
import { movementInputFor, moveOnWalkableLevel } from "./movement";
import type { GameScene } from "./scene";
import { hasStatusEffect, setStatusEffect, tickStatusEffects, type StatusEffect } from "./statusEffects";
import type { PlayerResources, ResourceKind } from "./types";
import type { MovementControlMode } from "./ui";

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
    private readonly world: GameScene,
    private readonly input: InputState,
    private readonly getLevel: () => LevelData,
    private readonly getMovementMode: () => MovementControlMode,
  ) {
    this.collisionBody = {
      position: this.world.player.position,
      radius: PLAYER_BALANCE.radius,
      collisionLayer: 0,
    };
  }

  get isMoving(): boolean {
    return this.moving;
  }

  reset(position: THREE.Vector3, collisionLayer: CollisionLayer): void {
    this.world.player.position.copy(position);
    this.collisionBody.collisionLayer = collisionLayer;
    this.resources.health = this.maxResources.health;
    this.resources.ammo = this.maxResources.ammo;
    this.resources.energy = this.maxResources.energy;
    this.statusEffects.length = 0;
    this.moving = false;
    this.world.playerBody.material.color.set(PLAYER_BASE_COLOR);
  }

  moveTo(position: THREE.Vector3, collisionLayer: CollisionLayer): void {
    this.world.player.position.copy(position);
    this.collisionBody.collisionLayer = collisionLayer;
    this.moving = false;
  }

  setCollisionLayer(collisionLayer: CollisionLayer): void {
    this.collisionBody.collisionLayer = collisionLayer;
  }

  updateTimers(dt: number): void {
    tickStatusEffects(this.statusEffects, dt);
    this.world.playerBody.material.color.lerp(new THREE.Color(this.targetBodyColor()), dt * 10);
  }

  regenerate(dt: number): void {
    this.resources.energy = Math.min(
      this.maxResources.energy,
      this.resources.energy + PLAYER_BALANCE.energyRegenPerSecond * dt,
    );
  }

  applyMovement(dt: number): void {
    const input = this.getMovementInput();
    this.moving = input.lengthSq() > 0;

    if (this.moving) {
      input.normalize();
      moveOnWalkableLevel(this.getLevel(), this.world.player.position, input, PLAYER_BALANCE.speed * dt);
    }
  }

  updateAim(): void {
    const aim = this.input.pointerWorld.clone().sub(this.world.player.position).setY(0);
    if (aim.lengthSq() > 0.01) {
      this.world.player.rotation.y = Math.atan2(aim.x, aim.z) + PLAYER_MODEL_FORWARD_OFFSET;
    }
  }

  updateRig(dt: number): void {
    this.world.playerRig.update(
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
    this.world.playerBody.material.color.set(
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
      position: vectorSnapshot(this.world.player.position),
      rotationY: this.world.player.rotation.y,
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

  private getMovementInput(): THREE.Vector3 {
    const strafe = (this.input.hasKey("KeyD") ? 1 : 0) - (this.input.hasKey("KeyA") ? 1 : 0);
    const forward = (this.input.hasKey("KeyW") ? 1 : 0) - (this.input.hasKey("KeyS") ? 1 : 0);
    return movementInputFor({
      mode: this.getMovementMode(),
      camera: this.world.camera,
      pointerWorld: this.input.pointerWorld,
      playerPosition: this.world.player.position,
      playerYaw: this.world.player.rotation.y,
      strafe,
      forward,
      target: this.movementInput,
    });
  }

  private targetBodyColor(): number {
    return this.resources.health <= PLAYER_BALANCE.lowHealthThreshold ? PLAYER_LOW_HEALTH_COLOR : PLAYER_BASE_COLOR;
  }
}

function vectorSnapshot(vector: THREE.Vector3): { x: number; y: number; z: number } {
  return { x: vector.x, y: vector.y, z: vector.z };
}
