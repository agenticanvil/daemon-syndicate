import * as THREE from "three";
import { WEAPON_BALANCE } from "./balance";
import type { CollisionBody2D, CollisionLayer } from "./collision";
import type { GameEffect } from "./gameEffects";
import type { PlayerResources, ResourceKind } from "./resourceTypes";
import type { Enemy } from "./enemyTypes";
import type { ProjectileDraft } from "./projectileTypes";
import type { PlayerDerivedStats } from "./upgrades";

export type AbilityId = "primary" | "nova";

export type CombatContext = {
  resources: PlayerResources;
  playerCollisionBody: CollisionBody2D;
  playerPosition: THREE.Vector3;
  collisionLayer: CollisionLayer;
  enemies: Enemy[];
  stats: PlayerDerivedStats;
  damageEnemy: (enemy: Enemy, amount: number, showText: boolean) => void;
  addProjectile: (projectile: ProjectileDraft) => void;
  emitEffect: (effect: GameEffect) => void;
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
      const aimDirection = aimWorld.clone().sub(context.playerPosition);
      aimDirection.y = 0;
      if (aimDirection.lengthSq() < 0.01) return false;
      aimDirection.normalize();

      const right = new THREE.Vector3(-aimDirection.z, 0, aimDirection.x);
      const position = context.playerPosition
        .clone()
        .addScaledVector(aimDirection, WEAPON_BALANCE.primary.spawnOffset)
        .addScaledVector(right, WEAPON_BALANCE.primary.muzzleSideOffset);
      position.y = WEAPON_BALANCE.primary.spawnHeight;

      const minAimDistance =
        WEAPON_BALANCE.primary.spawnOffset + Math.abs(WEAPON_BALANCE.primary.muzzleSideOffset) + 0.5;
      const aimDistanceSq = aimWorld.clone().sub(context.playerPosition).setY(0).lengthSq();
      const aimTarget =
        aimDistanceSq < minAimDistance * minAimDistance
          ? context.playerPosition.clone().addScaledVector(aimDirection, minAimDistance)
          : aimWorld;
      const shotDirection = aimTarget.clone().sub(position);
      shotDirection.y = 0;
      if (shotDirection.lengthSq() < 0.01) return false;
      shotDirection.normalize();

      context.addProjectile({
        position,
        velocity: shotDirection.multiplyScalar(WEAPON_BALANCE.primary.projectileSpeed),
        collisionLayer: context.collisionLayer,
        life: WEAPON_BALANCE.primary.projectileLife,
        damage: context.stats.primaryDamage,
        radius: WEAPON_BALANCE.primary.projectileRadius,
        pierceRemaining: context.stats.projectilePierce,
        hitEnemyIds: new Set(),
      });
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
      context.emitEffect({ type: "nova", position: context.playerPosition.clone(), radius: context.stats.novaRadius });
      context.resources.energy -= WEAPON_BALANCE.nova.energyCost;
      return true;
    },
  },
};
