import * as THREE from "three";
import { ENEMY_BALANCE, PLAYER_BALANCE } from "./balance";
import { distance2D, withinRadius2D, type CollisionBody2D, type CollisionLayer } from "./collision";
import { findProjectileWallImpact } from "./combatSystem";
import {
  chooseEnemyDefinition,
  encounterBudgetForMapLevel,
  enemyLevelForMapLevel,
  ENEMY_DEFINITIONS,
  type EnemyDefinition,
  type EnemyKind,
} from "./enemyDefinitions";
import type { EnemyViewHandle, GameplayView, ProjectileViewHandle } from "./gameView";
import { key, tileToWorld, worldToTile, type LevelData } from "./level";
import { canMoveDirectlyOnWalkableLevel, moveOnWalkableLevel } from "./movement";
import { findWorldPath, hasClearWorldPath, pathDirection } from "./pathfinding";
import type { EventQueue } from "./eventQueue";
import type { Rng } from "./rng";
import type { Enemy, EnemyDraft, EnemyProjectile, EnemyProjectileDraft, PlayerResources } from "./types";

const MOVEMENT_EPSILON = 0.0001;
const RANGED_PROJECTILE_HEIGHT = 0.58;
const RANGED_SPAWN_OFFSET = 0.48;

export class EnemySystem {
  private readonly enemies: Enemy[] = [];
  private readonly enemyProjectiles: EnemyProjectile[] = [];
  private readonly enemyViews = new Map<number, EnemyViewHandle>();
  private readonly enemyProjectileViews = new Map<number, ProjectileViewHandle>();
  private nextEnemyId = 1;
  private nextEnemyProjectileId = 1;

  constructor(
    private readonly view: GameplayView,
    private readonly events: EventQueue,
    private readonly playerCollisionBody: CollisionBody2D,
    private readonly resources: PlayerResources,
    private readonly getLevel: () => LevelData,
    private readonly getCollisionLayer: () => CollisionLayer,
    private readonly canDamagePlayer: () => boolean,
    private readonly rng: Rng = Math.random,
  ) {}

  get count(): number {
    return this.enemies.length;
  }

  get projectileCount(): number {
    return this.enemyProjectiles.length;
  }

  get all(): Enemy[] {
    return this.enemies;
  }

  spawnLevelEnemies(): void {
    const candidates = this.getLevel().spawnPoints
      .map(tileToWorld)
      .filter((position) => distance2D(position, this.view.player.position) >= ENEMY_BALANCE.minSpawnDistance);
    const mapLevel = this.getLevel().id;
    let remainingBudget = encounterBudgetForMapLevel(mapLevel);
    const maxCount = Math.min(ENEMY_BALANCE.maxLevelEnemyCount, candidates.length);

    for (let i = 0; i < maxCount && remainingBudget >= this.minimumBudgetCost(mapLevel); i += 1) {
      const definition = chooseEnemyDefinition(mapLevel, this.rng, { maxBudgetCost: remainingBudget });
      const index = Math.floor(this.rng() * candidates.length);
      const [spawn] = candidates.splice(index, 1);
      this.spawnEnemy(spawn, definition);
      remainingBudget -= definition.budgetCost;
    }
  }

  spawnEnemyAt(kind: EnemyKind, spawn: THREE.Vector3): void {
    const definition = ENEMY_DEFINITIONS.find((candidate) => candidate.kind === kind);
    this.spawnEnemy(spawn, definition);
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
    let damagedPlayerThisFrame = this.updateEnemyProjectiles(dt, false);

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
      const isRanged = enemy.attack.kind === "ranged";
      const hasLineOfSight = hasClearWorldPath(this.getLevel(), enemy.position, this.view.player.position);
      let moved = false;
      let movementDirection = pursuitDirection;

      this.updateEnemyAttackWindup(enemy, dt);

      if (isRanged) {
        movementDirection =
          enemy.attackWindupTimer === undefined
            ? this.getRangedEnemyMovementDirection(enemy, distance, pursuitDirection, hasLineOfSight)
            : new THREE.Vector3();
      }

      if (!isRanged && distance > PLAYER_BALANCE.radius + enemy.radius + ENEMY_BALANCE.stopProximity) {
        moved = this.moveEnemy(enemy, movementDirection, enemy.speed * dt);
      } else if (isRanged && movementDirection.lengthSq() > MOVEMENT_EPSILON) {
        moved = this.moveEnemy(enemy, movementDirection, enemy.speed * dt);
      }

      if (isRanged && (hasLineOfSight || enemy.attackWindupTimer !== undefined)) {
        const aimDirection = this.view.player.position.clone().sub(enemy.position).setY(0);
        if (aimDirection.lengthSq() > MOVEMENT_EPSILON) {
          enemy.facingYaw = this.getEnemyFacingYaw(aimDirection.normalize());
        }
      } else if (movementDirection.lengthSq() > MOVEMENT_EPSILON) {
        enemy.facingYaw = this.getEnemyFacingYaw(movementDirection);
      } else if (!this.enemyViews.get(enemy.id)?.updateRig) {
        enemy.facingYaw += dt * 2.4;
      }

      enemy.attackTimer -= dt;
      const inAttackRange =
        isRanged
          ? distance <= attackDistance && hasLineOfSight
          : withinRadius2D(enemy, this.playerCollisionBody, attackDistance);
      if (inAttackRange || enemy.attackWindupTimer !== undefined) {
        this.enemyViews.get(enemy.id)?.updateRig?.("melee", dt);
      } else {
        this.enemyViews.get(enemy.id)?.updateRig?.(moved ? "walk" : "idle", dt);
      }

      if (isRanged) {
        if (
          inAttackRange &&
          enemy.attackTimer <= 0 &&
          enemy.attackWindupTimer === undefined &&
          this.playerCollisionBody.collisionLayer === enemy.collisionLayer
        ) {
          const direction = this.view.player.position.clone().sub(enemy.position).setY(0).normalize();
          enemy.attackWindupTimer = enemy.attack.windup ?? 0.18;
          enemy.attackWindupDirection = direction;
        }
      } else if (
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
    this.syncEnemyProjectileViews();
  }

  clear(): void {
    for (const enemy of this.enemies.splice(0)) {
      this.disposeEnemyView(enemy.id);
    }
    for (const projectile of this.enemyProjectiles.splice(0)) {
      this.disposeEnemyProjectileView(projectile.id);
    }
  }

  snapshot(): object {
    return this.enemies.map((enemy) => ({
      id: enemy.id,
      kind: enemy.kind,
      enemyLevel: enemy.enemyLevel,
      position: vectorSnapshot(enemy.position),
      facingYaw: enemy.facingYaw,
      collisionLayer: enemy.collisionLayer,
      hp: enemy.hp,
      speed: enemy.speed,
      xpReward: enemy.xpReward,
      radius: enemy.radius,
      attack: { ...enemy.attack },
      dropTable: {
        chance: enemy.dropTable.chance,
        entries: enemy.dropTable.entries.map((entry) => ({ ...entry })),
      },
      attackTimer: enemy.attackTimer,
      attackWindupTimer: enemy.attackWindupTimer,
      attackWindupDirection: enemy.attackWindupDirection ? vectorSnapshot(enemy.attackWindupDirection) : undefined,
      deathTimer: enemy.deathTimer,
      path: enemy.path ? [...enemy.path] : undefined,
      pathTarget: enemy.pathTarget,
      pathRefreshTimer: enemy.pathRefreshTimer,
    }));
  }

  projectileSnapshot(): object {
    return this.enemyProjectiles.map((projectile) => ({
      id: projectile.id,
      position: vectorSnapshot(projectile.position),
      velocity: vectorSnapshot(projectile.velocity),
      collisionLayer: projectile.collisionLayer,
      life: projectile.life,
      damage: projectile.damage,
      radius: projectile.radius,
    }));
  }

  private spawnEnemy(spawn: THREE.Vector3, providedDefinition?: EnemyDefinition): void {
    const mapLevel = this.getLevel().id;
    const enemyLevel = enemyLevelForMapLevel(mapLevel, this.rng);
    const definition = providedDefinition ?? chooseEnemyDefinition(mapLevel, this.rng);
    const facingYaw = 0;

    this.addEnemy(
      {
        kind: definition.kind,
        enemyLevel,
        position: new THREE.Vector3(spawn.x, 0, spawn.z),
        facingYaw,
        collisionLayer: this.getCollisionLayer(),
        hp: definition.health(enemyLevel),
        speed: definition.speed(enemyLevel),
        xpReward: definition.xpReward(enemyLevel),
        radius: definition.radius,
        attack: { ...definition.attack, damage: definition.attackDamage(enemyLevel) },
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

  private syncEnemyProjectileViews(): void {
    for (const projectile of this.enemyProjectiles) {
      const view = this.enemyProjectileViews.get(projectile.id);
      view?.sync(projectile.position);
    }
  }

  private disposeEnemyView(id: number): void {
    const view = this.enemyViews.get(id);
    if (!view) return;
    view.dispose();
    this.enemyViews.delete(id);
  }

  private disposeEnemyProjectileView(id: number): void {
    const view = this.enemyProjectileViews.get(id);
    if (!view) return;
    view.dispose();
    this.enemyProjectileViews.delete(id);
  }

  private minimumBudgetCost(mapLevel: number): number {
    return ENEMY_DEFINITIONS.reduce((minimum, definition) => {
      const weight = definition.spawnWeight(mapLevel);
      if (weight <= 0) return minimum;
      return Math.min(minimum, definition.budgetCost);
    }, Infinity);
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

  private getRangedEnemyMovementDirection(
    enemy: Enemy,
    playerDistance: number,
    pursuitDirection: THREE.Vector3,
    hasLineOfSight: boolean,
  ): THREE.Vector3 {
    const toPlayer = this.view.player.position.clone().sub(enemy.position).setY(0);
    if (toPlayer.lengthSq() <= MOVEMENT_EPSILON) return new THREE.Vector3();
    toPlayer.normalize();

    const preferredMin = Math.max(enemy.attack.range * 0.46, PLAYER_BALANCE.radius + enemy.radius + 1.2);
    const preferredMax = enemy.attack.range * 0.78;
    const strafeSign = enemy.id % 2 === 0 ? 1 : -1;
    const strafe = new THREE.Vector3(-toPlayer.z, 0, toPlayer.x).multiplyScalar(strafeSign);

    if (playerDistance < preferredMin) {
      return toPlayer.multiplyScalar(-1).addScaledVector(strafe, 0.35).normalize();
    }
    if (!hasLineOfSight || playerDistance > preferredMax) {
      return pursuitDirection;
    }
    return strafe;
  }

  private updateEnemyAttackWindup(enemy: Enemy, dt: number): void {
    if (enemy.attackWindupTimer === undefined) return;

    enemy.attackWindupTimer -= dt;
    if (enemy.attackWindupTimer > 0) return;

    const direction =
      enemy.attackWindupDirection ??
      this.view.player.position.clone().sub(enemy.position).setY(0).normalize();
    this.fireEnemyProjectile(enemy, direction);
    enemy.attackTimer = enemy.attack.cooldown;
    enemy.attackWindupTimer = undefined;
    enemy.attackWindupDirection = undefined;
  }

  private fireEnemyProjectile(enemy: Enemy, direction: THREE.Vector3): void {
    if (direction.lengthSq() <= MOVEMENT_EPSILON) return;
    direction.normalize();
    const speed = enemy.attack.projectileSpeed ?? 8;
    const spawn = enemy.position
      .clone()
      .addScaledVector(direction, enemy.radius + RANGED_SPAWN_OFFSET)
      .setY(RANGED_PROJECTILE_HEIGHT);
    this.addEnemyProjectile({
      position: spawn,
      velocity: direction.clone().multiplyScalar(speed),
      collisionLayer: enemy.collisionLayer,
      life: enemy.attack.range / speed + 0.25,
      damage: enemy.attack.damage,
      radius: enemy.attack.projectileRadius ?? 0.22,
    });
  }

  private addEnemyProjectile(projectile: EnemyProjectileDraft): void {
    const id = this.nextEnemyProjectileId;
    this.nextEnemyProjectileId += 1;
    const view = this.view.createEnemyProjectileView(projectile.position, projectile.velocity);
    this.enemyProjectiles.push({ id, ...projectile });
    this.enemyProjectileViews.set(id, view);
  }

  private updateEnemyProjectiles(dt: number, damagedPlayerThisFrame: boolean): boolean {
    for (const projectile of this.enemyProjectiles) {
      const previousPosition = projectile.position.clone();
      projectile.position.addScaledVector(projectile.velocity, dt);
      projectile.life -= dt;

      const wallImpact = findProjectileWallImpact(this.getLevel(), previousPosition, projectile.position);
      if (wallImpact) {
        projectile.position.copy(wallImpact.position);
        projectile.life = 0;
        this.view.spawnProjectileImpact(wallImpact.position, projectile.velocity);
        continue;
      }

      if (
        !damagedPlayerThisFrame &&
        projectile.collisionLayer === this.playerCollisionBody.collisionLayer &&
        this.canDamagePlayer() &&
        withinRadius2D(projectile, this.playerCollisionBody, projectile.radius + this.playerCollisionBody.radius)
      ) {
        this.resources.health = Math.max(0, this.resources.health - projectile.damage);
        this.events.emit({ type: "playerDamaged", amount: projectile.damage });
        this.view.spawnProjectileImpact(projectile.position, projectile.velocity);
        projectile.life = 0;
        damagedPlayerThisFrame = true;
      }
    }

    for (let i = this.enemyProjectiles.length - 1; i >= 0; i -= 1) {
      const projectile = this.enemyProjectiles[i];
      if (projectile.life <= 0) {
        this.disposeEnemyProjectileView(projectile.id);
        this.enemyProjectiles.splice(i, 1);
      }
    }

    return damagedPlayerThisFrame;
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
          enemyLevel: enemy.enemyLevel,
          xpReward: enemy.xpReward,
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
