import * as THREE from "three";
import { TILE_SIZE } from "./constants";
import { overlaps2D, type CollisionBody2D, type CollisionLayer } from "./collision";
import type { GameplayView, ProjectileViewHandle } from "./gameView";
import { key, worldToTile, type LevelData } from "./level";
import type { Enemy, PlayerResources, Projectile, ProjectileDraft, VectorSnapshot } from "./types";
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

export class CombatSystem {
  private readonly projectiles: Projectile[] = [];
  private readonly projectileViews = new Map<number, ProjectileViewHandle>();
  private readonly abilityTimers: Record<AbilityId, number> = {
    primary: 0,
    nova: 0,
  };
  private nextProjectileId = 1;

  constructor(
    private readonly view: GameplayView,
    private readonly resources: PlayerResources,
    private readonly playerCollisionBody: CollisionBody2D,
    private readonly getCollisionLayer: () => CollisionLayer,
    private readonly getLevel: () => LevelData,
    private readonly getStats: () => PlayerDerivedStats,
    private readonly enemies: () => Enemy[],
    private readonly damageEnemy: (enemy: Enemy, amount: number, showText: boolean) => void,
  ) {}

  get projectileCount(): number {
    return this.projectiles.length;
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
    return this.fireAbility("nova", this.view.player.position);
  }

  updateProjectiles(dt: number): number {
    let impactCount = 0;

    for (const projectile of this.projectiles) {
      const previousPosition = projectile.position.clone();
      projectile.position.addScaledVector(projectile.velocity, dt);
      projectile.life -= dt;

      const wallImpact = findProjectileWallImpact(this.getLevel(), previousPosition, projectile.position);
      if (wallImpact) {
        projectile.position.copy(wallImpact.position);
        projectile.life = 0;
        this.view.spawnProjectileImpact(wallImpact.position, projectile.velocity);
        impactCount += 1;
        continue;
      }

      for (const enemy of this.enemies()) {
        if (enemy.deathTimer !== undefined) continue;
        if (projectile.hitEnemyIds?.has(enemy.id)) continue;
        if (overlaps2D(projectile, enemy)) {
          this.damageEnemy(enemy, projectile.damage, true);
          this.view.spawnProjectileImpact(projectile.position, projectile.velocity);
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
        this.disposeProjectileView(projectile.id);
        this.projectiles.splice(i, 1);
      }
    }

    this.syncProjectileViews();
    return impactCount;
  }

  clear(): void {
    for (const projectile of this.projectiles.splice(0)) {
      this.disposeProjectileView(projectile.id);
    }
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
        view: this.view,
        resources: this.resources,
        playerCollisionBody: this.playerCollisionBody,
        collisionLayer: this.getCollisionLayer(),
        enemies: this.enemies(),
        stats: this.getStats(),
        damageEnemy: this.damageEnemy,
        addProjectile: (projectile) => this.addProjectile(projectile),
      },
      aimWorld,
    );

    if (fired) {
      this.abilityTimers[id] = id === "nova" ? this.getStats().novaCooldown : ability.cooldown;
    }
    return fired;
  }

  private addProjectile(projectile: ProjectileDraft): void {
    const id = this.nextProjectileId;
    this.nextProjectileId += 1;
    const view = this.view.createProjectileView(projectile.position, projectile.velocity);
    this.projectiles.push({ id, ...projectile });
    this.projectileViews.set(id, view);
  }

  private syncProjectileViews(): void {
    for (const projectile of this.projectiles) {
      const view = this.projectileViews.get(projectile.id);
      view?.sync(projectile.position);
    }
  }

  private disposeProjectileView(id: number): void {
    const view = this.projectileViews.get(id);
    if (!view) return;
    view.dispose();
    this.projectileViews.delete(id);
  }
}

function vectorSnapshot(vector: THREE.Vector3): VectorSnapshot {
  return { x: vector.x, y: vector.y, z: vector.z };
}

export function findProjectileWallImpact(
  level: Pick<LevelData, "walkable">,
  previousPosition: THREE.Vector3,
  nextPosition: THREE.Vector3,
): ProjectileWallImpact | undefined {
  if (!isWorldPointOnPlatform(level, previousPosition)) return { position: previousPosition.clone() };

  let lastInside = previousPosition.clone();
  let firstOutside = nextPosition.clone();
  let foundOutside = !isWorldPointOnPlatform(level, nextPosition);
  const distance = previousPosition.distanceTo(nextPosition);
  const steps = Math.max(Math.ceil(distance / (TILE_SIZE * 0.22)), 1);

  for (let i = 1; i <= steps; i += 1) {
    const sample = previousPosition.clone().lerp(nextPosition, i / steps);
    if (!isWorldPointOnPlatform(level, sample)) {
      firstOutside = sample;
      foundOutside = true;
      break;
    }
    lastInside = sample;
  }
  if (!foundOutside) return undefined;

  for (let i = 0; i < 5; i += 1) {
    const midpoint = lastInside.clone().lerp(firstOutside, 0.5);
    if (isWorldPointOnPlatform(level, midpoint)) {
      lastInside = midpoint;
    } else {
      firstOutside = midpoint;
    }
  }

  return { position: lastInside };
}

function isWorldPointOnPlatform(level: Pick<LevelData, "walkable">, position: THREE.Vector3): boolean {
  return level.walkable.has(key(worldToTile(position)));
}
