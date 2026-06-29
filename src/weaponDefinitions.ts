import * as THREE from "three";
import { WEAPON_BALANCE } from "./balance";
import { withinRadius2D, type CollisionBody2D, type CollisionLayer } from "./collision";
import type { GameplayView } from "./gameView";
import type { PlayerResources, ResourceKind } from "./resourceTypes";
import type { Enemy } from "./enemyTypes";
import type { ProjectileDraft } from "./projectileTypes";
import type { PlayerDerivedStats } from "./upgrades";

export type AbilityId = "primary" | "nova";

export type CombatContext = {
  view: GameplayView;
  resources: PlayerResources;
  playerCollisionBody: CollisionBody2D;
  collisionLayer: CollisionLayer;
  enemies: Enemy[];
  stats: PlayerDerivedStats;
  damageEnemy: (enemy: Enemy, amount: number, showText: boolean) => void;
  addProjectile: (projectile: ProjectileDraft) => void;
};

export type AbilityDefinition = {
  id: AbilityId;
  resource: ResourceKind;
  cost: number;
  cooldown: number;
  fire: (context: CombatContext, aimWorld: THREE.Vector3) => boolean;
};

export const ABILITY_DEFINITIONS: Record<AbilityId, AbilityDefinition> = {
  primary: {
    id: "primary",
    resource: "ammo",
    cost: WEAPON_BALANCE.primary.ammoCost,
    cooldown: WEAPON_BALANCE.primary.cooldown,
    fire: (context, aimWorld) => {
      const direction = aimWorld.clone().sub(context.view.player.position);
      direction.y = 0;
      if (direction.lengthSq() < 0.01) return false;
      direction.normalize();

      const position = context.view.player.position
        .clone()
        .addScaledVector(direction, WEAPON_BALANCE.primary.spawnOffset);
      position.y = WEAPON_BALANCE.primary.spawnHeight;

      context.addProjectile({
        position,
        velocity: direction.multiplyScalar(WEAPON_BALANCE.primary.projectileSpeed),
        collisionLayer: context.collisionLayer,
        life: WEAPON_BALANCE.primary.projectileLife,
        damage: context.stats.primaryDamage,
        radius: WEAPON_BALANCE.primary.projectileRadius,
        pierceRemaining: context.stats.projectilePierce,
        hitEnemyIds: new Set(),
      });
      context.view.player.triggerFire();
      context.resources.ammo -= WEAPON_BALANCE.primary.ammoCost;
      return true;
    },
  },
  nova: {
    id: "nova",
    resource: "energy",
    cost: WEAPON_BALANCE.nova.energyCost,
    cooldown: WEAPON_BALANCE.nova.cooldown,
    fire: (context) => {
      context.view.spawnNova(context.view.player.position);

      for (const enemy of context.enemies) {
        if (enemy.deathTimer !== undefined) continue;
        if (withinRadius2D(enemy, context.playerCollisionBody, context.stats.novaRadius)) {
          context.damageEnemy(enemy, context.stats.novaDamage, true);
          const push = enemy.position.clone().sub(context.view.player.position).setY(0).normalize();
          enemy.position.addScaledVector(push, WEAPON_BALANCE.nova.pushDistance);
        }
      }

      context.resources.energy -= WEAPON_BALANCE.nova.energyCost;
      return true;
    },
  },
};
