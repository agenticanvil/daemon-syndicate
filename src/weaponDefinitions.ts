import * as THREE from "three";
import { WEAPON_BALANCE } from "./balance";
import { withinRadius2D, type CollisionBody2D, type CollisionLayer } from "./collision";
import type { EffectsSystem } from "./effectsSystem";
import type { GameScene } from "./scene";
import type { Enemy, PlayerResources, ProjectileDraft, ResourceKind } from "./types";

export type AbilityId = "primary" | "nova";

export type CombatContext = {
  world: GameScene;
  effects: EffectsSystem;
  resources: PlayerResources;
  playerCollisionBody: CollisionBody2D;
  collisionLayer: CollisionLayer;
  enemies: Enemy[];
  damageEnemy: (enemy: Enemy, amount: number, showText: boolean) => void;
  addProjectile: (projectile: ProjectileDraft, mesh: THREE.Mesh) => void;
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
      const direction = aimWorld.clone().sub(context.world.player.position);
      direction.y = 0;
      if (direction.lengthSq() < 0.01) return false;
      direction.normalize();

      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), context.world.materials.projectile);
      mesh.position.copy(context.world.player.position).addScaledVector(direction, WEAPON_BALANCE.primary.spawnOffset);
      mesh.position.y = WEAPON_BALANCE.primary.spawnHeight;
      context.world.scene.add(mesh);

      context.addProjectile(
        {
          position: mesh.position.clone(),
          velocity: direction.multiplyScalar(WEAPON_BALANCE.primary.projectileSpeed),
          collisionLayer: context.collisionLayer,
          life: WEAPON_BALANCE.primary.projectileLife,
          damage: WEAPON_BALANCE.primary.damage,
          radius: WEAPON_BALANCE.primary.projectileRadius,
        },
        mesh,
      );
      context.world.playerRig.triggerFire();
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
      context.effects.spawnNova(context.world.player.position);

      for (const enemy of context.enemies) {
        if (enemy.deathTimer !== undefined) continue;
        if (withinRadius2D(enemy, context.playerCollisionBody, WEAPON_BALANCE.nova.radius)) {
          context.damageEnemy(enemy, WEAPON_BALANCE.nova.damage, true);
          const push = enemy.position.clone().sub(context.world.player.position).setY(0).normalize();
          enemy.position.addScaledVector(push, WEAPON_BALANCE.nova.pushDistance);
        }
      }

      context.resources.energy -= WEAPON_BALANCE.nova.energyCost;
      return true;
    },
  },
};
