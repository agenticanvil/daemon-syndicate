import * as THREE from "three";
import { ELITE_ENEMY_SETTINGS } from "./assets/enemies/eliteEnemy/eliteEnemyAsset";
import { LEAN_HUNTER_SETTINGS } from "./assets/enemies/leanHunterAsset";
import { ENEMY_BALANCE, PLAYER_BALANCE } from "./balance";
import { distance2D, withinRadius2D, type CollisionBody2D, type CollisionLayer } from "./collision";
import { disposeObject3D } from "./entityLifecycle";
import { key, tileToWorld, worldToTile, type LevelData } from "./level";
import { canMoveOnWalkableLevel, moveOnWalkableLevel } from "./movement";
import { findWorldPath, pathDirection } from "./pathfinding";
import type { EffectsSystem } from "./effectsSystem";
import type { PickupSystem } from "./pickupSystem";
import type { GameScene } from "./scene";
import type { Enemy, PlayerResources } from "./types";

const MOVEMENT_EPSILON = 0.0001;

export class EnemySystem {
  private readonly enemies: Enemy[] = [];

  constructor(
    private readonly world: GameScene,
    private readonly effects: EffectsSystem,
    private readonly pickups: PickupSystem,
    private readonly playerCollisionBody: CollisionBody2D,
    private readonly resources: PlayerResources,
    private readonly getLevel: () => LevelData,
    private readonly getWave: () => number,
    private readonly getCollisionLayer: () => CollisionLayer,
    private readonly canDamagePlayer: () => boolean,
    private readonly onPlayerDamaged: () => void,
    private readonly onPlayerKilled: () => void,
  ) {}

  get count(): number {
    return this.enemies.length;
  }

  get all(): Enemy[] {
    return this.enemies;
  }

  spawnLevelEnemies(): void {
    const candidates = this.getLevel().spawnPoints
      .map(tileToWorld)
      .filter((position) => distance2D(position, this.world.player.position) >= ENEMY_BALANCE.minSpawnDistance);
    const targetCount = Math.min(this.levelEnemyCount(), candidates.length);

    for (let i = 0; i < targetCount; i += 1) {
      const index = Math.floor(Math.random() * candidates.length);
      const [spawn] = candidates.splice(index, 1);
      this.spawnEnemy(spawn);
    }
  }

  damageEnemy(enemy: Enemy, amount: number, showText: boolean): void {
    if (enemy.deathTimer !== undefined) return;
    enemy.hp -= amount;
    if (showText) {
      this.effects.spawnDamageText(enemy.mesh.position, Math.round(amount).toString());
    }
  }

  update(dt: number): number {
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0 && enemy.deathTimer === undefined) {
        enemy.deathTimer = ENEMY_BALANCE.deathDuration;
        enemy.updateRig?.("death", 0);
      }

      if (enemy.deathTimer !== undefined) {
        enemy.deathTimer -= dt;
        enemy.updateRig?.("death", dt);
        continue;
      }

      const distance = distance2D(enemy.mesh.position, this.world.player.position);
      const attackDistance = PLAYER_BALANCE.radius + enemy.radius + ENEMY_BALANCE.attackProximity;
      const pursuitDirection = this.getEnemyPursuitDirection(enemy, distance, enemy.speed * dt, dt);
      let moved = false;

      if (distance > PLAYER_BALANCE.radius + enemy.radius + ENEMY_BALANCE.stopProximity) {
        moved = this.moveEnemy(enemy, pursuitDirection, enemy.speed * dt);
      }

      if (pursuitDirection.lengthSq() > MOVEMENT_EPSILON) {
        enemy.mesh.rotation.y = this.getEnemyFacingYaw(pursuitDirection);
      } else if (!enemy.updateRig) {
        enemy.mesh.rotation.y += dt * 2.4;
      }

      enemy.attackTimer -= dt;
      const inAttackRange = withinRadius2D(enemy, this.playerCollisionBody, attackDistance);
      if (inAttackRange) {
        enemy.updateRig?.("melee", dt);
      } else {
        enemy.updateRig?.(moved ? "walk" : "idle", dt);
      }

      if (
        inAttackRange &&
        enemy.attackTimer <= 0 &&
        this.playerCollisionBody.collisionLayer === enemy.collisionLayer &&
        this.canDamagePlayer()
      ) {
        this.resources.health = Math.max(0, this.resources.health - ENEMY_BALANCE.attackDamage);
        enemy.attackTimer = ENEMY_BALANCE.attackCooldown;
        this.onPlayerDamaged();
        this.world.playerBody.material.color.set(this.resources.health <= PLAYER_BALANCE.lowHealthThreshold ? 0xff7474 : 0xffffff);
        if (this.resources.health <= 0) {
          this.onPlayerKilled();
        }
      }
    }

    return this.collectDeadEnemies();
  }

  clear(): void {
    for (const enemy of this.enemies.splice(0)) {
      this.world.scene.remove(enemy.mesh);
      disposeObject3D(enemy.mesh, Boolean(enemy.updateRig));
    }
  }

  private spawnEnemy(spawn: THREE.Vector3): void {
    const wave = this.getWave();
    const elite = Math.random() < Math.min(0.08 + wave * 0.015, 0.26);
    const rig = elite ? undefined : this.world.createLeanHunterRig();
    const mesh = rig?.root ?? this.world.createEliteEnemyAsset().root;
    mesh.position.set(spawn.x, elite ? 0.72 : 0, spawn.z);
    this.world.scene.add(mesh);

    this.enemies.push({
      mesh,
      updateRig: rig ? (animation, dt) => rig.update({ animation }, dt) : undefined,
      collisionLayer: this.getCollisionLayer(),
      hp: elite ? ELITE_ENEMY_SETTINGS.health + wave * 8 : LEAN_HUNTER_SETTINGS.health + wave * 5,
      speed: elite ? 2.2 + wave * 0.05 : 2.8 + wave * 0.07,
      radius: elite ? ELITE_ENEMY_SETTINGS.collision.radius : LEAN_HUNTER_SETTINGS.collision.radius,
      attackTimer: 0,
      pathRefreshTimer: Math.random() * ENEMY_BALANCE.pathRefreshInterval,
    });
  }

  private levelEnemyCount(): number {
    return Math.min(10 + this.getLevel().id * 3, ENEMY_BALANCE.maxLevelEnemyCount);
  }

  private getEnemyPursuitDirection(
    enemy: Enemy,
    playerDistance: number,
    moveDistance: number,
    dt: number,
  ): THREE.Vector3 {
    const direct = this.world.player.position.clone().sub(enemy.mesh.position).setY(0);
    if (direct.lengthSq() <= MOVEMENT_EPSILON) return direct;
    direct.normalize();

    if (playerDistance > ENEMY_BALANCE.pathfindingRadius) {
      enemy.path = undefined;
      enemy.pathTarget = undefined;
      return direct;
    }

    if (playerDistance <= ENEMY_BALANCE.directApproachRadius && this.canEnemyMove(enemy, direct, moveDistance)) {
      enemy.path = undefined;
      enemy.pathTarget = undefined;
      return direct;
    }

    const playerKey = key(worldToTile(this.world.player.position));
    enemy.pathRefreshTimer = (enemy.pathRefreshTimer ?? 0) - dt;
    if (!enemy.path || enemy.pathTarget !== playerKey || enemy.pathRefreshTimer <= 0) {
      enemy.path = findWorldPath(this.getLevel(), enemy.mesh.position, this.world.player.position);
      enemy.pathTarget = playerKey;
      enemy.pathRefreshTimer = ENEMY_BALANCE.pathRefreshInterval + Math.random() * ENEMY_BALANCE.pathRefreshJitter;
    }

    return pathDirection(enemy.path, enemy.mesh.position, ENEMY_BALANCE.waypointReachedDistance) ?? direct;
  }

  private moveEnemy(enemy: Enemy, direction: THREE.Vector3, distance: number): boolean {
    return moveOnWalkableLevel(this.getLevel(), enemy.mesh.position, direction, distance);
  }

  private canEnemyMove(enemy: Enemy, direction: THREE.Vector3, distance: number): boolean {
    return canMoveOnWalkableLevel(this.getLevel(), enemy.mesh.position, direction, distance);
  }

  private collectDeadEnemies(): number {
    let kills = 0;
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      if (enemy.deathTimer !== undefined && enemy.deathTimer <= 0) {
        this.pickups.maybeDropPickup(enemy.mesh.position);
        this.world.scene.remove(enemy.mesh);
        disposeObject3D(enemy.mesh, Boolean(enemy.updateRig));
        this.enemies.splice(i, 1);
        kills += 1;
      }
    }
    return kills;
  }

  private getEnemyFacingYaw(direction: THREE.Vector3): number {
    return Math.atan2(-direction.x, -direction.z);
  }
}
