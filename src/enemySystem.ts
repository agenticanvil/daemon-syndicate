import * as THREE from "three";
import { ENEMY_BALANCE } from "./balance";
import { distance2D, withinRadius2D, type CollisionBody2D, type CollisionLayer } from "./collision";
import { findProjectileWallImpact } from "./combatSystem";
import { canFireEnemyProjectile, updateEnemyBehavior } from "./enemyBehavior";
import {
  chooseEnemyDefinition,
  encounterBudgetForMapDepth,
  enemyLevelForMapDepth,
  ENEMY_DEFINITIONS,
  type EnemyDefinition,
  type EnemyKind,
} from "./enemyDefinitions";
import type { GameEffect } from "./gameEffects";
import { tileToWorld, type LevelData } from "./level";
import type { EventQueue } from "./eventQueue";
import type { Rng } from "./rng";
import type { Enemy, EnemyDraft } from "./enemyTypes";
import type { EnemyProjectile, EnemyProjectileDraft } from "./projectileTypes";
import type { VectorSnapshot } from "./vectorTypes";

const RANGED_PROJECTILE_HEIGHT = 0.58;
const RANGED_SPAWN_OFFSET = 0.48;

export type EnemySystemSnapshot = Array<{
  id: number;
  kind: EnemyKind;
  enemyLevel: number;
  position: VectorSnapshot;
  facingYaw: number;
  collisionLayer: CollisionLayer;
  health: number;
  speed: number;
  movementSound?: Enemy["movementSound"];
  xpReward: number;
  radius: number;
  attack: Enemy["attack"];
  dropTable: Enemy["dropTable"];
  attackTimer: number;
  attackWindupTimer?: number;
  attackWindupDirection?: VectorSnapshot;
  deathTimer?: number;
  path?: string[];
  pathTarget?: string;
  pathRefreshTimer?: number;
}>;

export type EnemyProjectileSystemSnapshot = Array<{
  id: number;
  position: VectorSnapshot;
  velocity: VectorSnapshot;
  collisionLayer: CollisionLayer;
  life: number;
  damage: number;
  radius: number;
}>;

export class EnemySystem {
  private readonly enemies: Enemy[] = [];
  private readonly enemyProjectiles: EnemyProjectile[] = [];
  private nextEnemyId = 1;
  private nextEnemyProjectileId = 1;

  constructor(
    private readonly emitEffect: (effect: GameEffect) => void,
    private readonly events: EventQueue,
    private readonly playerCollisionBody: CollisionBody2D,
    private readonly getPlayerPosition: () => THREE.Vector3,
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

  get allEnemyProjectiles(): readonly EnemyProjectile[] {
    return this.enemyProjectiles;
  }

  spawnLevelEnemies(): void {
    const candidates = this.getLevel().spawnPoints
      .map(tileToWorld)
      .filter((position) => distance2D(position, this.getPlayerPosition()) >= ENEMY_BALANCE.minSpawnDistance);
    const mapDepth = this.getLevel().mapDepth;
    let remainingBudget = encounterBudgetForMapDepth(mapDepth);
    const maxCount = Math.min(ENEMY_BALANCE.maxLevelEnemyCount, candidates.length);
    const selectedSpawns: THREE.Vector3[] = [];

    for (let i = 0; i < maxCount && remainingBudget >= this.minimumBudgetCost(mapDepth); i += 1) {
      const definition = chooseEnemyDefinition(mapDepth, this.rng, { maxBudgetCost: remainingBudget });
      const spawn = this.takeSpreadSpawn(candidates, selectedSpawns);
      if (!spawn) break;
      selectedSpawns.push(spawn);
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
    enemy.health -= amount;
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
      if (enemy.health <= 0 && enemy.deathTimer === undefined) {
        enemy.deathTimer = ENEMY_BALANCE.deathDuration;
        enemy.animation = "death";
      }

      if (enemy.deathTimer !== undefined) {
        enemy.deathTimer -= dt;
        enemy.animation = "death";
        continue;
      }

      const behavior = updateEnemyBehavior({
        enemy,
        dt,
        level: this.getLevel(),
        playerPosition: this.getPlayerPosition(),
        playerCollisionBody: this.playerCollisionBody,
        canDamagePlayer: this.canDamagePlayer(),
        damagedPlayerThisFrame,
        hasAnimatedRig: true,
        rng: this.rng,
        emitPlayerDamaged: (amount) => this.events.emit({ type: "playerDamaged", amount }),
        fireEnemyProjectile: (target, direction) => this.fireEnemyProjectile(target, direction),
      });
      damagedPlayerThisFrame = behavior.damagedPlayer;
      enemy.animation = behavior.animation;
    }

    this.collectDeadEnemies();
  }

  clear(): void {
    this.enemies.length = 0;
    this.enemyProjectiles.length = 0;
  }

  snapshot(): EnemySystemSnapshot {
    return this.enemies.map((enemy) => ({
      id: enemy.id,
      kind: enemy.kind,
      enemyLevel: enemy.enemyLevel,
      position: vectorSnapshot(enemy.position),
      facingYaw: enemy.facingYaw,
      collisionLayer: enemy.collisionLayer,
      health: enemy.health,
      speed: enemy.speed,
      movementSound: enemy.movementSound,
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

  projectileSnapshot(): EnemyProjectileSystemSnapshot {
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
    const mapDepth = this.getLevel().mapDepth;
    const enemyLevel = enemyLevelForMapDepth(mapDepth, this.rng);
    const definition = providedDefinition ?? chooseEnemyDefinition(mapDepth, this.rng);
    const facingYaw = 0;

    this.addEnemy(
      {
        kind: definition.kind,
        enemyLevel,
        position: new THREE.Vector3(spawn.x, 0, spawn.z),
        facingYaw,
        collisionLayer: this.getCollisionLayer(),
        health: definition.health(enemyLevel),
        speed: definition.speed(enemyLevel),
        movementSound: definition.movementSound,
        xpReward: definition.xpReward(enemyLevel),
        radius: definition.radius,
        attack: { ...definition.attack, damage: definition.attackDamage(enemyLevel) },
        dropTable: definition.dropTable,
        attackTimer: 0,
        pathRefreshTimer: this.rng() * ENEMY_BALANCE.pathRefreshInterval,
        animation: "idle",
      },
    );
  }

  private addEnemy(enemy: EnemyDraft): void {
    const id = this.nextEnemyId;
    this.nextEnemyId += 1;
    this.enemies.push({ id, ...enemy });
  }

  private minimumBudgetCost(mapDepth: number): number {
    return ENEMY_DEFINITIONS.reduce((minimum, definition) => {
      const weight = definition.spawnWeight(mapDepth);
      if (weight <= 0) return minimum;
      return Math.min(minimum, definition.budgetCost);
    }, Infinity);
  }

  private takeSpreadSpawn(candidates: THREE.Vector3[], selectedSpawns: THREE.Vector3[]): THREE.Vector3 | undefined {
    if (candidates.length === 0) return undefined;

    let bestIndex = 0;
    let bestScore = -Infinity;

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const playerDistance = distance2D(candidate, this.getPlayerPosition());
      const nearestSpawnDistance =
        selectedSpawns.length === 0
          ? ENEMY_BALANCE.spawnSpreadDistance
          : Math.min(...selectedSpawns.map((spawn) => distance2D(candidate, spawn)));
      const spreadScore = Math.min(nearestSpawnDistance, ENEMY_BALANCE.spawnSpreadDistance);
      const score = spreadScore * 2 + playerDistance * 0.35 + this.rng() * ENEMY_BALANCE.spawnSpreadDistance;

      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }

    const [spawn] = candidates.splice(bestIndex, 1);
    return spawn;
  }

  private fireEnemyProjectile(enemy: Enemy, direction: THREE.Vector3): void {
    if (!canFireEnemyProjectile(direction)) return;
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
    this.enemyProjectiles.push({ id, ...projectile });
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
        this.emitEffect({
          type: "projectileImpact",
          position: wallImpact.position.clone(),
          incomingVelocity: projectile.velocity.clone(),
        });
        continue;
      }

      if (
        !damagedPlayerThisFrame &&
        projectile.collisionLayer === this.playerCollisionBody.collisionLayer &&
        this.canDamagePlayer() &&
        withinRadius2D(projectile, this.playerCollisionBody, projectile.radius + this.playerCollisionBody.radius)
      ) {
        this.events.emit({ type: "playerDamaged", amount: projectile.damage });
        this.emitEffect({
          type: "projectileImpact",
          position: projectile.position.clone(),
          incomingVelocity: projectile.velocity.clone(),
        });
        projectile.life = 0;
        damagedPlayerThisFrame = true;
      }
    }

    for (let i = this.enemyProjectiles.length - 1; i >= 0; i -= 1) {
      const projectile = this.enemyProjectiles[i];
      if (projectile.life <= 0) {
        this.enemyProjectiles.splice(i, 1);
      }
    }

    return damagedPlayerThisFrame;
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
        this.enemies.splice(i, 1);
        kills += 1;
      }
    }
    return kills;
  }
}

function vectorSnapshot(vector: THREE.Vector3): VectorSnapshot {
  return { x: vector.x, y: vector.y, z: vector.z };
}
