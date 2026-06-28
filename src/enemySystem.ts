import * as THREE from "three";
import { ENEMY_BALANCE, PLAYER_BALANCE } from "./balance";
import { distance2D, withinRadius2D, type CollisionBody2D, type CollisionLayer } from "./collision";
import { chooseEnemyDefinition, ENEMY_DEFINITIONS, type EnemyKind } from "./enemyDefinitions";
import type { EnemyViewHandle, GameplayView } from "./gameView";
import { key, tileToWorld, worldToTile, type LevelData } from "./level";
import { canMoveDirectlyOnWalkableLevel, moveOnWalkableLevel } from "./movement";
import { findWorldPath, hasClearWorldPath, pathDirection } from "./pathfinding";
import type { EventQueue } from "./eventQueue";
import type { Rng } from "./rng";
import type { Enemy, EnemyDraft, PlayerResources } from "./types";

const MOVEMENT_EPSILON = 0.0001;

export class EnemySystem {
  private readonly enemies: Enemy[] = [];
  private readonly enemyViews = new Map<number, EnemyViewHandle>();
  private nextEnemyId = 1;

  constructor(
    private readonly view: GameplayView,
    private readonly events: EventQueue,
    private readonly playerCollisionBody: CollisionBody2D,
    private readonly resources: PlayerResources,
    private readonly getLevel: () => LevelData,
    private readonly getWave: () => number,
    private readonly getCollisionLayer: () => CollisionLayer,
    private readonly canDamagePlayer: () => boolean,
    private readonly rng: Rng = Math.random,
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
      .filter((position) => distance2D(position, this.view.player.position) >= ENEMY_BALANCE.minSpawnDistance);
    const targetCount = Math.min(this.levelEnemyCount(), candidates.length);

    for (let i = 0; i < targetCount; i += 1) {
      const index = Math.floor(this.rng() * candidates.length);
      const [spawn] = candidates.splice(index, 1);
      this.spawnEnemy(spawn);
    }
  }

  spawnEnemyAt(kind: EnemyKind, spawn: THREE.Vector3): void {
    this.spawnEnemy(spawn, kind);
  }

  damageEnemy(enemy: Enemy, amount: number, showText: boolean): void {
    if (enemy.deathTimer !== undefined) return;
    enemy.hp -= amount;
    if (showText) {
      this.events.emit({
        type: "enemyDamaged",
        enemyId: enemy.id,
        amount,
        position: enemy.position.clone(),
      });
    }
  }

  update(dt: number): void {
    let damagedPlayerThisFrame = false;

    for (const enemy of this.enemies) {
      if (enemy.hp <= 0 && enemy.deathTimer === undefined) {
        enemy.deathTimer = ENEMY_BALANCE.deathDuration;
        this.enemyViews.get(enemy.id)?.updateRig?.("death", 0);
      }

      if (enemy.deathTimer !== undefined) {
        enemy.deathTimer -= dt;
        this.enemyViews.get(enemy.id)?.updateRig?.("death", dt);
        continue;
      }

      const distance = distance2D(enemy.position, this.view.player.position);
      const attackDistance = PLAYER_BALANCE.radius + enemy.radius + enemy.attack.range;
      const pursuitDirection = this.getEnemyPursuitDirection(enemy, distance, enemy.speed * dt, dt);
      let moved = false;

      if (distance > PLAYER_BALANCE.radius + enemy.radius + ENEMY_BALANCE.stopProximity) {
        moved = this.moveEnemy(enemy, pursuitDirection, enemy.speed * dt);
      }

      if (pursuitDirection.lengthSq() > MOVEMENT_EPSILON) {
        enemy.facingYaw = this.getEnemyFacingYaw(pursuitDirection);
      } else if (!this.enemyViews.get(enemy.id)?.updateRig) {
        enemy.facingYaw += dt * 2.4;
      }

      enemy.attackTimer -= dt;
      const inAttackRange = withinRadius2D(enemy, this.playerCollisionBody, attackDistance);
      if (inAttackRange) {
        this.enemyViews.get(enemy.id)?.updateRig?.("melee", dt);
      } else {
        this.enemyViews.get(enemy.id)?.updateRig?.(moved ? "walk" : "idle", dt);
      }

      if (
        inAttackRange &&
        enemy.attackTimer <= 0 &&
        this.playerCollisionBody.collisionLayer === enemy.collisionLayer &&
        this.canDamagePlayer() &&
        !damagedPlayerThisFrame
      ) {
        this.resources.health = Math.max(0, this.resources.health - enemy.attack.damage);
        enemy.attackTimer = enemy.attack.cooldown;
        damagedPlayerThisFrame = true;
        this.events.emit({ type: "playerDamaged", amount: enemy.attack.damage });
      }
    }

    this.collectDeadEnemies();
    this.syncEnemyViews();
  }

  clear(): void {
    for (const enemy of this.enemies.splice(0)) {
      this.disposeEnemyView(enemy.id);
    }
  }

  snapshot(): object {
    return this.enemies.map((enemy) => ({
      id: enemy.id,
      kind: enemy.kind,
      position: vectorSnapshot(enemy.position),
      facingYaw: enemy.facingYaw,
      collisionLayer: enemy.collisionLayer,
      hp: enemy.hp,
      speed: enemy.speed,
      radius: enemy.radius,
      attack: { ...enemy.attack },
      dropTable: {
        chance: enemy.dropTable.chance,
        entries: enemy.dropTable.entries.map((entry) => ({ ...entry })),
      },
      attackTimer: enemy.attackTimer,
      deathTimer: enemy.deathTimer,
      path: enemy.path ? [...enemy.path] : undefined,
      pathTarget: enemy.pathTarget,
      pathRefreshTimer: enemy.pathRefreshTimer,
    }));
  }

  private spawnEnemy(spawn: THREE.Vector3, kind?: EnemyKind): void {
    const wave = this.getWave();
    const definition = kind
      ? ENEMY_DEFINITIONS.find((candidate) => candidate.kind === kind) ?? chooseEnemyDefinition(wave, this.rng)
      : chooseEnemyDefinition(wave, this.rng);
    const facingYaw = 0;

    this.addEnemy(
      {
        kind: definition.kind,
        position: new THREE.Vector3(spawn.x, 0, spawn.z),
        facingYaw,
        collisionLayer: this.getCollisionLayer(),
        hp: definition.health(wave),
        speed: definition.speed(wave),
        radius: definition.radius,
        attack: definition.attack,
        dropTable: definition.dropTable,
        attackTimer: 0,
        pathRefreshTimer: this.rng() * ENEMY_BALANCE.pathRefreshInterval,
      },
      this.view.createEnemyView(definition.kind, spawn, facingYaw),
    );
  }

  private addEnemy(enemy: EnemyDraft, view: EnemyViewHandle): void {
    const id = this.nextEnemyId;
    this.nextEnemyId += 1;
    this.enemies.push({ id, ...enemy });
    this.enemyViews.set(id, view);
  }

  private syncEnemyViews(): void {
    for (const enemy of this.enemies) {
      const view = this.enemyViews.get(enemy.id);
      if (!view) continue;
      view.sync(enemy.position, enemy.facingYaw);
    }
  }

  private disposeEnemyView(id: number): void {
    const view = this.enemyViews.get(id);
    if (!view) return;
    view.dispose();
    this.enemyViews.delete(id);
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
    const direct = this.view.player.position.clone().sub(enemy.position).setY(0);
    if (direct.lengthSq() <= MOVEMENT_EPSILON) return direct;
    direct.normalize();

    if (playerDistance > ENEMY_BALANCE.pathfindingRadius) {
      enemy.path = undefined;
      enemy.pathTarget = undefined;
      return direct;
    }

    if (
      playerDistance <= ENEMY_BALANCE.directApproachRadius &&
      hasClearWorldPath(this.getLevel(), enemy.position, this.view.player.position) &&
      this.canEnemyMoveDirectly(enemy, direct, moveDistance)
    ) {
      enemy.path = undefined;
      enemy.pathTarget = undefined;
      return direct;
    }

    const playerKey = key(worldToTile(this.view.player.position));
    enemy.pathRefreshTimer = (enemy.pathRefreshTimer ?? 0) - dt;
    if (!enemy.path || enemy.pathTarget !== playerKey || enemy.pathRefreshTimer <= 0) {
      enemy.path = findWorldPath(this.getLevel(), enemy.position, this.view.player.position);
      enemy.pathTarget = playerKey;
      enemy.pathRefreshTimer = ENEMY_BALANCE.pathRefreshInterval + this.rng() * ENEMY_BALANCE.pathRefreshJitter;
    }

    return pathDirection(enemy.path, enemy.position, ENEMY_BALANCE.waypointReachedDistance) ?? direct;
  }

  private moveEnemy(enemy: Enemy, direction: THREE.Vector3, distance: number): boolean {
    return moveOnWalkableLevel(this.getLevel(), enemy.position, direction, distance);
  }

  private canEnemyMoveDirectly(enemy: Enemy, direction: THREE.Vector3, distance: number): boolean {
    return canMoveDirectlyOnWalkableLevel(this.getLevel(), enemy.position, direction, distance);
  }

  private collectDeadEnemies(): number {
    let kills = 0;
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      if (enemy.deathTimer !== undefined && enemy.deathTimer <= 0) {
        this.events.emit({
          type: "enemyKilled",
          enemyId: enemy.id,
          kind: enemy.kind,
          position: enemy.position.clone(),
          dropTable: enemy.dropTable,
        });
        this.disposeEnemyView(enemy.id);
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

function vectorSnapshot(vector: THREE.Vector3): { x: number; y: number; z: number } {
  return { x: vector.x, y: vector.y, z: vector.z };
}
