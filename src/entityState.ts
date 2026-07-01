import type { Enemy } from "./enemyTypes";
import type { Pickup } from "./pickupTypes";
import type { EnemyProjectile, Projectile } from "./projectileTypes";

export type EntityViewState = {
  enemies: readonly Enemy[];
  projectiles: readonly Projectile[];
  enemyProjectiles: readonly EnemyProjectile[];
  pickups: readonly Pickup[];
};

