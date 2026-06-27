import * as THREE from "three";
import { LEVEL_HEIGHT, LEVEL_WIDTH, TILE_SIZE } from "./constants";
import { overlaps2D, type CollisionBody2D, type CollisionLayer } from "./collision";
import type { EffectsSystem } from "./effectsSystem";
import type { GameScene } from "./scene";
import type { Enemy, PlayerResources, Projectile, ProjectileDraft, ProjectileView } from "./types";
import { ABILITY_DEFINITIONS, type AbilityId } from "./weaponDefinitions";

const PROJECTILE_FORWARD = new THREE.Vector3(0, 1, 0);
const PROJECTILE_GEOMETRY = new THREE.CylinderGeometry(
  0.045,
  0.014,
  TILE_SIZE * 0.2,
  8,
  1,
  false,
);

export class CombatSystem {
  private readonly projectiles: Projectile[] = [];
  private readonly projectileViews = new Map<number, ProjectileView>();
  private readonly projectileMeshPool: THREE.Mesh[] = [];
  private readonly abilityTimers: Record<AbilityId, number> = {
    primary: 0,
    nova: 0,
  };
  private nextProjectileId = 1;

  constructor(
    private readonly world: GameScene,
    private readonly effects: EffectsSystem,
    private readonly resources: PlayerResources,
    private readonly playerCollisionBody: CollisionBody2D,
    private readonly getCollisionLayer: () => CollisionLayer,
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

  firePrimary(pointerWorld: THREE.Vector3): void {
    this.fireAbility("primary", pointerWorld);
  }

  fireNova(): void {
    this.fireAbility("nova", this.world.player.position);
  }

  updateProjectiles(dt: number): void {
    for (const projectile of this.projectiles) {
      projectile.position.addScaledVector(projectile.velocity, dt);
      projectile.life -= dt;

      for (const enemy of this.enemies()) {
        if (enemy.deathTimer !== undefined) continue;
        if (overlaps2D(projectile, enemy)) {
          this.damageEnemy(enemy, projectile.damage, true);
          projectile.life = 0;
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
      })),
    };
  }

  private isAbilityReady(id: AbilityId): boolean {
    const ability = ABILITY_DEFINITIONS[id];
    return this.abilityTimers[id] <= 0 && this.resources[ability.resource] >= ability.cost;
  }

  private fireAbility(id: AbilityId, aimWorld: THREE.Vector3): void {
    const ability = ABILITY_DEFINITIONS[id];
    if (!this.isAbilityReady(id)) return;

    const fired = ability.fire(
      {
        world: this.world,
        effects: this.effects,
        resources: this.resources,
        playerCollisionBody: this.playerCollisionBody,
        collisionLayer: this.getCollisionLayer(),
        enemies: this.enemies(),
        damageEnemy: this.damageEnemy,
        addProjectile: (projectile) => this.addProjectile(projectile),
      },
      aimWorld,
    );

    if (fired) {
      this.abilityTimers[id] = ability.cooldown;
    }
  }

  private addProjectile(projectile: ProjectileDraft): void {
    const id = this.nextProjectileId;
    this.nextProjectileId += 1;
    const mesh = this.acquireProjectileMesh(projectile.position, projectile.velocity);
    this.projectiles.push({ id, ...projectile });
    this.projectileViews.set(id, { id, mesh });
  }

  private syncProjectileViews(): void {
    for (const projectile of this.projectiles) {
      const view = this.projectileViews.get(projectile.id);
      view?.mesh.position.copy(projectile.position);
    }
  }

  private disposeProjectileView(id: number): void {
    const view = this.projectileViews.get(id);
    if (!view) return;
    this.world.scene.remove(view.mesh);
    this.projectileMeshPool.push(view.mesh);
    this.projectileViews.delete(id);
  }

  private acquireProjectileMesh(position: THREE.Vector3, velocity: THREE.Vector3): THREE.Mesh {
    const mesh =
      this.projectileMeshPool.pop() ?? new THREE.Mesh(PROJECTILE_GEOMETRY, this.world.materials.projectile);
    mesh.position.copy(position);
    mesh.quaternion.setFromUnitVectors(PROJECTILE_FORWARD, velocity.clone().normalize());
    mesh.visible = true;
    this.world.scene.add(mesh);
    return mesh;
  }
}

function vectorSnapshot(vector: THREE.Vector3): { x: number; y: number; z: number } {
  return { x: vector.x, y: vector.y, z: vector.z };
}
