import * as THREE from "three";
import { LEVEL_HEIGHT, LEVEL_WIDTH, TILE_SIZE } from "./constants";
import { overlaps2D, type CollisionBody2D, type CollisionLayer } from "./collision";
import type { GameplayView, ProjectileViewHandle } from "./gameView";
import type { Enemy, PlayerResources, Projectile, ProjectileDraft } from "./types";
import type { PlayerDerivedStats } from "./upgrades";
import { ABILITY_DEFINITIONS, type AbilityId } from "./weaponDefinitions";

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

  updateProjectiles(dt: number): void {
    for (const projectile of this.projectiles) {
      projectile.position.addScaledVector(projectile.velocity, dt);
      projectile.life -= dt;

      for (const enemy of this.enemies()) {
        if (enemy.deathTimer !== undefined) continue;
        if (projectile.hitEnemyIds?.has(enemy.id)) continue;
        if (overlaps2D(projectile, enemy)) {
          this.damageEnemy(enemy, projectile.damage, true);
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
      if (
        projectile.life <= 0 ||
        Math.abs(projectile.position.x) > (LEVEL_WIDTH * TILE_SIZE) / 2 ||
        Math.abs(projectile.position.z) > (LEVEL_HEIGHT * TILE_SIZE) / 2
      ) {
        this.disposeProjectileView(projectile.id);
        this.projectiles.splice(i, 1);
      }
    }

    this.syncProjectileViews();
  }

  clear(): void {
    for (const projectile of this.projectiles.splice(0)) {
      this.disposeProjectileView(projectile.id);
    }
  }

  snapshot(): object {
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

function vectorSnapshot(vector: THREE.Vector3): { x: number; y: number; z: number } {
  return { x: vector.x, y: vector.y, z: vector.z };
}
