import * as THREE from "three";
import { LEVEL_HEIGHT, LEVEL_WIDTH, TILE_SIZE } from "./constants";
import { WEAPON_BALANCE } from "./balance";
import { overlaps2D, withinRadius2D, type CollisionBody2D, type CollisionLayer } from "./collision";
import { disposeMeshGeometry } from "./entityLifecycle";
import type { EffectsSystem } from "./effectsSystem";
import type { GameScene } from "./scene";
import type { Enemy, PlayerResources, Projectile } from "./types";

export class CombatSystem {
  private readonly projectiles: Projectile[] = [];
  private primaryTimer = 0;
  private novaTimer = 0;

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
    return this.primaryTimer <= 0 && this.resources.ammo >= WEAPON_BALANCE.primary.ammoCost;
  }

  get novaReady(): boolean {
    return this.novaTimer <= 0 && this.resources.energy >= WEAPON_BALANCE.nova.energyCost;
  }

  resetTimers(): void {
    this.primaryTimer = 0;
    this.novaTimer = 0;
  }

  prepareNextLevel(): void {
    this.primaryTimer = 0;
    this.novaTimer = Math.min(this.novaTimer, 0.4);
  }

  updateTimers(dt: number): void {
    this.primaryTimer = Math.max(this.primaryTimer - dt, 0);
    this.novaTimer = Math.max(this.novaTimer - dt, 0);
  }

  firePrimary(pointerWorld: THREE.Vector3): void {
    if (!this.primaryReady) return;

    const direction = pointerWorld.clone().sub(this.world.player.position);
    direction.y = 0;
    if (direction.lengthSq() < 0.01) return;
    direction.normalize();

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), this.world.materials.projectile);
    mesh.position.copy(this.world.player.position).addScaledVector(direction, WEAPON_BALANCE.primary.spawnOffset);
    mesh.position.y = WEAPON_BALANCE.primary.spawnHeight;
    this.world.scene.add(mesh);

    this.projectiles.push({
      mesh,
      velocity: direction.multiplyScalar(WEAPON_BALANCE.primary.projectileSpeed),
      collisionLayer: this.getCollisionLayer(),
      life: WEAPON_BALANCE.primary.projectileLife,
      damage: WEAPON_BALANCE.primary.damage,
      radius: WEAPON_BALANCE.primary.projectileRadius,
    });
    this.world.playerRig.triggerFire();
    this.resources.ammo -= WEAPON_BALANCE.primary.ammoCost;
    this.primaryTimer = WEAPON_BALANCE.primary.cooldown;
  }

  fireNova(): void {
    if (!this.novaReady) return;

    this.effects.spawnNova(this.world.player.position);

    for (const enemy of this.enemies()) {
      if (enemy.deathTimer !== undefined) continue;
      if (withinRadius2D(enemy, this.playerCollisionBody, WEAPON_BALANCE.nova.radius)) {
        this.damageEnemy(enemy, WEAPON_BALANCE.nova.damage, true);
        const push = enemy.mesh.position.clone().sub(this.world.player.position).setY(0).normalize();
        enemy.mesh.position.addScaledVector(push, WEAPON_BALANCE.nova.pushDistance);
      }
    }

    this.resources.energy -= WEAPON_BALANCE.nova.energyCost;
    this.novaTimer = WEAPON_BALANCE.nova.cooldown;
  }

  updateProjectiles(dt: number): void {
    for (const projectile of this.projectiles) {
      projectile.mesh.position.addScaledVector(projectile.velocity, dt);
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
        Math.abs(projectile.mesh.position.x) > (LEVEL_WIDTH * TILE_SIZE) / 2 ||
        Math.abs(projectile.mesh.position.z) > (LEVEL_HEIGHT * TILE_SIZE) / 2
      ) {
        this.world.scene.remove(projectile.mesh);
        disposeMeshGeometry(projectile.mesh);
        this.projectiles.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const projectile of this.projectiles.splice(0)) {
      this.world.scene.remove(projectile.mesh);
      disposeMeshGeometry(projectile.mesh);
    }
  }
}
