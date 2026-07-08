import * as THREE from "three";
import { TILE_SIZE } from "./constants";
import { overlaps2D, withinRadius2D, type CollisionBody2D, type CollisionLayer } from "./collision";
import { WEAPON_BALANCE } from "./balance";
import type { GameEffect } from "./gameEffects";
import { key, worldToTile, type LevelData } from "./level";
import type { PlayerResources } from "./resourceTypes";
import type { Enemy } from "./enemyTypes";
import type { Projectile, ProjectileDraft } from "./projectileTypes";
import type { VectorSnapshot } from "./vectorTypes";
import type { PlayerDerivedStats } from "./upgrades";
import { ABILITY_DEFINITIONS, type AbilityId } from "./weaponDefinitions";

export type ProjectileWallImpact = {
  position: THREE.Vector3;
};

export type CombatSystemSnapshot = {
  abilityTimers: Record<AbilityId, number>;
  projectiles: Array<{
    id: number;
    position: VectorSnapshot;
    velocity: VectorSnapshot;
    collisionLayer: CollisionLayer;
    life: number;
    damage: number;
    radius: number;
    pierceRemaining?: number;
  }>;
};

type ActiveNova = {
  position: THREE.Vector3;
  collisionLayer: CollisionLayer;
  duration: number;
  life: number;
  damage: number;
  radius: number;
  hitEnemyIds: Set<number>;
};

export class CombatSystem {
  private readonly projectiles: Projectile[] = [];
  private readonly activeNovas: ActiveNova[] = [];
  private readonly abilityTimers: Record<AbilityId, number> = {
    primary: 0,
    nova: 0,
  };
  private readonly previousProjectilePosition = new THREE.Vector3();
  private readonly wallImpactPosition = new THREE.Vector3();
  private nextProjectileId = 1;

  constructor(
    private readonly emitEffect: (effect: GameEffect) => void,
    private readonly resources: PlayerResources,
    private readonly playerCollisionBody: CollisionBody2D,
    private readonly getPlayerPosition: () => THREE.Vector3,
    private readonly getCollisionLayer: () => CollisionLayer,
    private readonly getLevel: () => LevelData,
    private readonly getStats: () => PlayerDerivedStats,
    private readonly enemies: () => Enemy[],
    private readonly damageEnemy: (enemy: Enemy, amount: number, showText: boolean) => void,
  ) {}

  get projectileCount(): number {
    return this.projectiles.length;
  }

  get allProjectiles(): readonly Projectile[] {
    return this.projectiles;
  }

  get primaryReady(): boolean {
    return this.isAbilityReady("primary");
  }

  get novaReady(): boolean {
    return this.isAbilityReady("nova");
  }

  resetTimers(): void {
    this.abilityTimers.primary = 0;
    this.abilityTimers.nova = 0;
  }

  prepareNextLevel(): void {
    this.abilityTimers.primary = 0;
    this.abilityTimers.nova = Math.min(this.abilityTimers.nova, 0.4);
  }

  updateTimers(dt: number): void {
    for (const id of Object.keys(this.abilityTimers) as AbilityId[]) {
      this.abilityTimers[id] = Math.max(this.abilityTimers[id] - dt, 0);
    }
  }

  firePrimary(pointerWorld: THREE.Vector3): boolean {
    return this.fireAbility("primary", pointerWorld);
  }

  fireNova(): boolean {
    return this.fireAbility("nova", this.getPlayerPosition());
  }

  updateProjectiles(dt: number): number {
    let impactCount = 0;
    this.updateNovas(dt);

    for (const projectile of this.projectiles) {
      const previousPosition = this.previousProjectilePosition.copy(projectile.position);
      projectile.position.addScaledVector(projectile.velocity, dt);
      projectile.life -= dt;

      if (findProjectileWallImpactPosition(this.getLevel(), previousPosition, projectile.position, this.wallImpactPosition)) {
        projectile.position.copy(this.wallImpactPosition);
        projectile.life = 0;
        this.emitEffect({
          type: "projectileImpact",
          position: this.wallImpactPosition.clone(),
          incomingVelocity: projectile.velocity.clone(),
        });
        impactCount += 1;
        continue;
      }

      for (const enemy of this.enemies()) {
        if (enemy.deathTimer !== undefined) continue;
        if (projectile.hitEnemyIds?.has(enemy.id)) continue;
        if (overlaps2D(projectile, enemy)) {
          this.damageEnemy(enemy, projectile.damage, true);
          this.emitEffect({
            type: "projectileImpact",
            position: projectile.position.clone(),
            incomingVelocity: projectile.velocity.clone(),
          });
          impactCount += 1;
          projectile.hitEnemyIds?.add(enemy.id);
          if ((projectile.pierceRemaining ?? 0) > 0) {
            projectile.pierceRemaining = (projectile.pierceRemaining ?? 0) - 1;
          } else {
            projectile.life = 0;
          }
          break;
        }
      }
    }

    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = this.projectiles[i];
      if (projectile.life <= 0) {
        this.projectiles.splice(i, 1);
      }
    }

    return impactCount;
  }

  clear(): void {
    this.projectiles.length = 0;
    this.activeNovas.length = 0;
  }

  snapshot(): CombatSystemSnapshot {
    return {
      abilityTimers: { ...this.abilityTimers },
      projectiles: this.projectiles.map((projectile) => ({
        id: projectile.id,
        position: vectorSnapshot(projectile.position),
        velocity: vectorSnapshot(projectile.velocity),
        collisionLayer: projectile.collisionLayer,
        life: projectile.life,
        damage: projectile.damage,
        radius: projectile.radius,
        pierceRemaining: projectile.pierceRemaining,
      })),
    };
  }

  private isAbilityReady(id: AbilityId): boolean {
    const ability = ABILITY_DEFINITIONS[id];
    return this.abilityTimers[id] <= 0 && this.resources[ability.resource] >= ability.cost;
  }

  private fireAbility(id: AbilityId, aimWorld: THREE.Vector3): boolean {
    const ability = ABILITY_DEFINITIONS[id];
    if (!this.isAbilityReady(id)) return false;

    const fired = ability.fire(
      {
        resources: this.resources,
        playerCollisionBody: this.playerCollisionBody,
        playerPosition: this.getPlayerPosition(),
        collisionLayer: this.getCollisionLayer(),
        enemies: this.enemies(),
        stats: this.getStats(),
        damageEnemy: this.damageEnemy,
        addProjectile: (projectile) => this.addProjectile(projectile),
        emitEffect: this.emitEffect,
      },
      aimWorld,
    );

    if (fired) {
      if (id === "nova") {
        const stats = this.getStats();
        this.activeNovas.push({
          position: this.getPlayerPosition().clone(),
          collisionLayer: this.getCollisionLayer(),
          duration: WEAPON_BALANCE.nova.duration,
          life: WEAPON_BALANCE.nova.duration,
          damage: stats.novaDamage,
          radius: stats.novaRadius,
          hitEnemyIds: new Set(),
        });
        this.updateNovas(0);
      }
      this.abilityTimers[id] = id === "nova" ? this.getStats().novaCooldown : ability.cooldown;
    }
    return fired;
  }

  private addProjectile(projectile: ProjectileDraft): void {
    const id = this.nextProjectileId;
    this.nextProjectileId += 1;
    this.projectiles.push({ id, ...projectile });
  }

  private updateNovas(dt: number): void {
    for (const nova of this.activeNovas) {
      nova.life -= dt;
      if (nova.life <= 0) continue;
      const progress = 1 - THREE.MathUtils.clamp(nova.life / nova.duration, 0, 1);
      const radius = nova.radius * novaExpansionScale(progress);

      const novaBody = {
        position: nova.position,
        radius: this.playerCollisionBody.radius,
        collisionLayer: nova.collisionLayer,
      };

      for (const enemy of this.enemies()) {
        if (enemy.deathTimer !== undefined) continue;
        if (nova.hitEnemyIds.has(enemy.id)) continue;
        if (withinRadius2D(enemy, novaBody, radius)) {
          this.damageEnemy(enemy, nova.damage, true);
          nova.hitEnemyIds.add(enemy.id);

          const push = enemy.position.clone().sub(nova.position).setY(0);
          if (push.lengthSq() > 0.0001) {
            push.normalize();
            enemy.position.addScaledVector(push, WEAPON_BALANCE.nova.pushDistance);
          }
        }
      }
    }

    for (let i = this.activeNovas.length - 1; i >= 0; i -= 1) {
      if (this.activeNovas[i].life <= 0) {
        this.activeNovas.splice(i, 1);
      }
    }
  }
}

function novaExpansionScale(progress: number): number {
  const easedProgress = 1 - Math.pow(1 - progress, WEAPON_BALANCE.nova.expansionPower);
  return WEAPON_BALANCE.nova.startScale + easedProgress * (1 - WEAPON_BALANCE.nova.startScale);
}

function vectorSnapshot(vector: THREE.Vector3): VectorSnapshot {
  return { x: vector.x, y: vector.y, z: vector.z };
}

export function findProjectileWallImpact(
  level: Pick<LevelData, "walkable">,
  previousPosition: THREE.Vector3,
  nextPosition: THREE.Vector3,
): ProjectileWallImpact | undefined {
  const position = new THREE.Vector3();
  return findProjectileWallImpactPosition(level, previousPosition, nextPosition, position) ? { position } : undefined;
}

const WALL_LAST_INSIDE = new THREE.Vector3();
const WALL_FIRST_OUTSIDE = new THREE.Vector3();
const WALL_SAMPLE = new THREE.Vector3();
const WALL_MIDPOINT = new THREE.Vector3();

export function findProjectileWallImpactPosition(
  level: Pick<LevelData, "walkable">,
  previousPosition: THREE.Vector3,
  nextPosition: THREE.Vector3,
  target: THREE.Vector3,
): boolean {
  if (!isWorldPointOnPlatform(level, previousPosition)) {
    target.copy(previousPosition);
    return true;
  }

  const lastInside = WALL_LAST_INSIDE.copy(previousPosition);
  const firstOutside = WALL_FIRST_OUTSIDE.copy(nextPosition);
  let foundOutside = !isWorldPointOnPlatform(level, nextPosition);
  const distance = previousPosition.distanceTo(nextPosition);
  const steps = Math.max(Math.ceil(distance / (TILE_SIZE * 0.22)), 1);

  for (let i = 1; i <= steps; i += 1) {
    const sample = WALL_SAMPLE.copy(previousPosition).lerp(nextPosition, i / steps);
    if (!isWorldPointOnPlatform(level, sample)) {
      firstOutside.copy(sample);
      foundOutside = true;
      break;
    }
    lastInside.copy(sample);
  }
  if (!foundOutside) return false;

  for (let i = 0; i < 5; i += 1) {
    const midpoint = WALL_MIDPOINT.copy(lastInside).lerp(firstOutside, 0.5);
    if (isWorldPointOnPlatform(level, midpoint)) {
      lastInside.copy(midpoint);
    } else {
      firstOutside.copy(midpoint);
    }
  }

  target.copy(lastInside);
  return true;
}

function isWorldPointOnPlatform(level: Pick<LevelData, "walkable">, position: THREE.Vector3): boolean {
  return level.walkable.has(key(worldToTile(position)));
}
