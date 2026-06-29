import * as THREE from "three";
import { PLAYER_BALANCE } from "./balance";
import type { CollisionBody2D, CollisionLayer } from "./collision";
import { PLAYER_MAX } from "./constants";
import type { GameplayView } from "./gameView";
import type { LevelData } from "./level";
import { moveOnWalkableLevel } from "./movement";
import type { PlayerCommand } from "./playerCommand";
import { hasStatusEffect, setStatusEffect, tickStatusEffects, type StatusEffect } from "./statusEffects";
import type { PlayerResources, ResourceKind, VectorSnapshot } from "./types";
import type { PlayerDerivedStats } from "./upgrades";

const PLAYER_MODEL_FORWARD_OFFSET = Math.PI;
const PLAYER_BASE_COLOR = 0x9bf0df;
const PLAYER_FLASH_COLOR = 0xffffff;
const PLAYER_LOW_HEALTH_COLOR = 0xff7474;

export type PlayerDamageResult = {
  applied: boolean;
  gameOver: boolean;
};

export type PlayerSystemSnapshot = {
  position: VectorSnapshot;
  rotationY: number;
  collisionLayer: CollisionLayer;
  resources: PlayerResources;
  maxResources: PlayerResources;
  statusEffects: Array<{ kind: StatusEffect["kind"]; remaining: number }>;
  moving: boolean;
  dashTimer: number;
  emergencyShieldReady: boolean;
};

export class PlayerSystem {
  readonly resources: PlayerResources = { ...PLAYER_MAX };
  readonly collisionBody: CollisionBody2D;

  private readonly movementInput = new THREE.Vector3();
  private readonly statusEffects: StatusEffect[] = [];
  private moving = false;
  private dashTimer = 0;
  private emergencyShieldReady = true;

  constructor(
    private readonly view: GameplayView,
    private readonly getLevel: () => LevelData,
    private readonly getStats: () => PlayerDerivedStats,
  ) {
    this.collisionBody = {
      position: this.view.player.position,
      radius: PLAYER_BALANCE.radius,
      collisionLayer: 0,
    };
  }

  get maxResources(): PlayerResources {
    return this.getStats().maxResources;
  }

  get currentDashTimer(): number {
    return this.dashTimer;
  }

  reset(position: THREE.Vector3, collisionLayer: CollisionLayer): void {
    this.view.player.position.copy(position);
    this.collisionBody.collisionLayer = collisionLayer;
    this.resources.health = this.maxResources.health;
    this.resources.ammo = this.maxResources.ammo;
    this.resources.energy = this.maxResources.energy;
    this.statusEffects.length = 0;
    this.moving = false;
    this.dashTimer = 0;
    this.emergencyShieldReady = true;
    this.view.player.setBodyColor(PLAYER_BASE_COLOR);
  }

  moveTo(position: THREE.Vector3, collisionLayer: CollisionLayer): void {
    this.view.player.position.copy(position);
    this.collisionBody.collisionLayer = collisionLayer;
    this.moving = false;
  }

  updateTimers(dt: number): void {
    this.dashTimer = Math.max(0, this.dashTimer - dt);
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
      moveOnWalkableLevel(this.getLevel(), this.view.player.position, input, this.getStats().movementSpeed * dt);
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
        moveSpeed: this.getStats().movementSpeed,
        damaged: this.hasStatus("invulnerable"),
        lowHealth: this.resources.health <= PLAYER_BALANCE.lowHealthThreshold,
      },
      dt,
    );
  }

  takeDamage(amount: number): PlayerDamageResult {
    if (amount <= 0 || this.hasStatus("invulnerable")) {
      return { applied: false, gameOver: false };
    }

    this.resources.health = Math.max(0, this.resources.health - amount);
    const stats = this.getStats();
    if (
      stats.emergencyShieldUnlocked &&
      this.emergencyShieldReady &&
      this.resources.health <= PLAYER_BALANCE.lowHealthThreshold
    ) {
      this.emergencyShieldReady = false;
      this.resources.health = Math.max(1, this.resources.health);
      this.setStatus("shield", 1.2);
      this.setStatus("invulnerable", 1.2);
      this.view.player.setBodyColor(PLAYER_FLASH_COLOR);
      return { applied: true, gameOver: false };
    }

    this.setStatus("invulnerable", PLAYER_BALANCE.invulnerabilityDuration);
    this.view.player.setBodyColor(
      this.resources.health <= PLAYER_BALANCE.lowHealthThreshold ? PLAYER_LOW_HEALTH_COLOR : PLAYER_FLASH_COLOR,
    );
    return { applied: true, gameOver: this.resources.health <= 0 };
  }

  tryDash(command: PlayerCommand): boolean {
    const stats = this.getStats();
    if (!stats.dashUnlocked || this.dashTimer > 0 || this.resources.energy < stats.dashEnergyCost) return false;

    const direction = command.movement.clone().setY(0);
    if (direction.lengthSq() <= 0.001) {
      direction.copy(command.aimWorld).sub(this.view.player.position).setY(0);
    }
    if (direction.lengthSq() <= 0.001) return false;

    direction.normalize();
    this.resources.energy -= stats.dashEnergyCost;
    this.dashTimer = stats.dashCooldown;
    this.setStatus("invulnerable", Math.max(0.18, stats.dashCooldown * 0.18));
    return moveOnWalkableLevel(this.getLevel(), this.view.player.position, direction, stats.dashDistance);
  }

  grantResource(kind: ResourceKind, amount: number): void {
    this.resources[kind] = Math.min(this.maxResources[kind], this.resources[kind] + amount);
  }

  applyDerivedStatsChange(previous: PlayerDerivedStats, next: PlayerDerivedStats): void {
    for (const kind of ["health", "ammo", "energy"] as const) {
      const delta = next.maxResources[kind] - previous.maxResources[kind];
      if (delta > 0) {
        this.resources[kind] = Math.min(next.maxResources[kind], this.resources[kind] + delta);
      } else {
        this.resources[kind] = Math.min(this.resources[kind], next.maxResources[kind]);
      }
    }
  }

  hasStatus(kind: StatusEffect["kind"]): boolean {
    return hasStatusEffect(this.statusEffects, kind);
  }

  snapshot(): PlayerSystemSnapshot {
    return {
      position: vectorSnapshot(this.view.player.position),
      rotationY: this.view.player.rotation.y,
      collisionLayer: this.collisionBody.collisionLayer,
      resources: { ...this.resources },
      maxResources: { ...this.maxResources },
      statusEffects: this.statusEffects.map((status) => ({ ...status })),
      moving: this.moving,
      dashTimer: this.dashTimer,
      emergencyShieldReady: this.emergencyShieldReady,
    };
  }

  private setStatus(kind: StatusEffect["kind"], remaining: number): void {
    setStatusEffect(this.statusEffects, { kind, remaining });
  }

  private targetBodyColor(): number {
    return this.resources.health <= PLAYER_BALANCE.lowHealthThreshold ? PLAYER_LOW_HEALTH_COLOR : PLAYER_BASE_COLOR;
  }
}

function vectorSnapshot(vector: THREE.Vector3): VectorSnapshot {
  return { x: vector.x, y: vector.y, z: vector.z };
}
