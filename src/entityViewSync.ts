import type { Enemy } from "./enemyTypes";
import type { EntityViewState } from "./entityState";
import type {
  EnemyViewHandle,
  GameplayView,
  PickupViewHandle,
  ProjectileViewHandle,
} from "./gameView";
import type { Pickup } from "./pickupTypes";
import type { EnemyProjectile, Projectile } from "./projectileTypes";

export class EntityViewSync {
  private readonly enemyViews = new Map<number, EnemyViewHandle>();
  private readonly projectileViews = new Map<number, ProjectileViewHandle>();
  private readonly enemyProjectileViews = new Map<number, ProjectileViewHandle>();
  private readonly pickupViews = new Map<number, PickupViewHandle>();
  private readonly liveEnemyIds = new Set<number>();
  private readonly liveProjectileIds = new Set<number>();
  private readonly liveEnemyProjectileIds = new Set<number>();
  private readonly livePickupIds = new Set<number>();

  constructor(private readonly view: GameplayView) {}

  sync(state: EntityViewState, dt: number): void {
    this.syncEnemies(state.enemies, dt);
    this.syncProjectiles(state.projectiles);
    this.syncEnemyProjectiles(state.enemyProjectiles);
    this.syncPickups(state.pickups, dt);
  }

  clear(): void {
    disposeViews(this.enemyViews);
    disposeViews(this.projectileViews);
    disposeViews(this.enemyProjectileViews);
    disposeViews(this.pickupViews);
  }

  private syncEnemies(enemies: readonly Enemy[], dt: number): void {
    const liveIds = this.liveEnemyIds;
    liveIds.clear();

    for (const enemy of enemies) {
      liveIds.add(enemy.id);
      const view =
        this.enemyViews.get(enemy.id) ?? this.addEnemyView(enemy);
      view.updateRig?.(enemy.animation, dt);
      view.sync(enemy.position, enemy.facingYaw);
    }

    disposeMissingViews(this.enemyViews, liveIds);
  }

  private addEnemyView(enemy: Enemy): EnemyViewHandle {
    const view = this.view.createEnemyView(enemy.id, enemy.kind, enemy.position, enemy.facingYaw);
    this.enemyViews.set(enemy.id, view);
    return view;
  }

  private syncProjectiles(projectiles: readonly Projectile[]): void {
    const liveIds = this.liveProjectileIds;
    liveIds.clear();

    for (const projectile of projectiles) {
      liveIds.add(projectile.id);
      const view =
        this.projectileViews.get(projectile.id) ?? this.addProjectileView(projectile);
      view.sync(projectile.position);
    }

    disposeMissingViews(this.projectileViews, liveIds);
  }

  private addProjectileView(projectile: Projectile): ProjectileViewHandle {
    const view = this.view.createProjectileView(projectile.position, projectile.velocity);
    this.projectileViews.set(projectile.id, view);
    return view;
  }

  private syncEnemyProjectiles(projectiles: readonly EnemyProjectile[]): void {
    const liveIds = this.liveEnemyProjectileIds;
    liveIds.clear();

    for (const projectile of projectiles) {
      liveIds.add(projectile.id);
      const view =
        this.enemyProjectileViews.get(projectile.id) ?? this.addEnemyProjectileView(projectile);
      view.sync(projectile.position);
    }

    disposeMissingViews(this.enemyProjectileViews, liveIds);
  }

  private addEnemyProjectileView(projectile: EnemyProjectile): ProjectileViewHandle {
    const view = this.view.createEnemyProjectileView(projectile.position, projectile.velocity);
    this.enemyProjectileViews.set(projectile.id, view);
    return view;
  }

  private syncPickups(pickups: readonly Pickup[], dt: number): void {
    const liveIds = this.livePickupIds;
    liveIds.clear();

    for (const pickup of pickups) {
      liveIds.add(pickup.id);
      const view = this.pickupViews.get(pickup.id) ?? this.addPickupView(pickup);
      view.sync(pickup.position, dt);
    }

    disposeMissingViews(this.pickupViews, liveIds);
  }

  private addPickupView(pickup: Pickup): PickupViewHandle {
    const view = this.view.createPickupView(pickup.kind, pickup.position);
    this.pickupViews.set(pickup.id, view);
    return view;
  }
}

function disposeMissingViews<T extends { dispose: () => void }>(views: Map<number, T>, liveIds: Set<number>): void {
  for (const [id, view] of views) {
    if (liveIds.has(id)) continue;
    view.dispose();
    views.delete(id);
  }
}

function disposeViews<T extends { dispose: () => void }>(views: Map<number, T>): void {
  for (const view of views.values()) {
    view.dispose();
  }
  views.clear();
}
