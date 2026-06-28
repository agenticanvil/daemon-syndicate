import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { WEAPON_BALANCE } from "./balance";
import type { GameplayView } from "./gameView";
import { ABILITY_DEFINITIONS, type CombatContext } from "./weaponDefinitions";
import type { Enemy, PlayerResources, ProjectileDraft } from "./types";

function enemyAt(id: number, x: number, z: number, collisionLayer: number): Enemy {
  return {
    id,
    kind: "leanHunter",
    position: new THREE.Vector3(x, 0, z),
    facingYaw: 0,
    collisionLayer,
    hp: 100,
    speed: 1,
    radius: 0.5,
    attack: { kind: "melee", damage: 9, cooldown: 0.72, range: 0.42 },
    dropTable: { chance: 0, entries: [{ kind: "ammo", weight: 1, amount: 1 }] },
    attackTimer: 0,
  };
}

function combatContext(overrides: Partial<CombatContext> = {}): CombatContext {
  const resources: PlayerResources = { health: 100, ammo: 80, energy: 100 };
  return {
    view: {
      player: {
        position: new THREE.Vector3(0, 0, 0),
        rotation: new THREE.Euler(),
        setBodyColor: vi.fn(),
        lerpBodyColor: vi.fn(),
        updateRig: vi.fn(),
        triggerFire: vi.fn(),
      },
      renderLevel: vi.fn(),
      resetReticle: vi.fn(),
      createEnemyView: vi.fn(),
      createProjectileView: vi.fn(),
      createPickupView: vi.fn(),
      spawnDamageText: vi.fn(),
      spawnNova: vi.fn(),
      updateEffects: vi.fn(),
      clearEffects: vi.fn(),
      snapshotEffects: vi.fn(() => ({ damageTexts: [], novaMeshes: [] })),
    } as unknown as GameplayView,
    resources,
    playerCollisionBody: {
      position: new THREE.Vector3(0, 0, 0),
      radius: 0.55,
      collisionLayer: 1,
    },
    collisionLayer: 1,
    enemies: [],
    damageEnemy: vi.fn(),
    addProjectile: vi.fn(),
    ...overrides,
  };
}

describe("ABILITY_DEFINITIONS", () => {
  it("exposes current resource costs and cooldowns for readiness checks", () => {
    expect(ABILITY_DEFINITIONS.primary.resource).toBe("ammo");
    expect(ABILITY_DEFINITIONS.primary.cost).toBe(WEAPON_BALANCE.primary.ammoCost);
    expect(ABILITY_DEFINITIONS.primary.cooldown).toBe(WEAPON_BALANCE.primary.cooldown);
    expect(ABILITY_DEFINITIONS.nova.resource).toBe("energy");
    expect(ABILITY_DEFINITIONS.nova.cost).toBe(WEAPON_BALANCE.nova.energyCost);
    expect(ABILITY_DEFINITIONS.nova.cooldown).toBe(WEAPON_BALANCE.nova.cooldown);
  });

  it("creates a primary projectile draft with the expected combat settings", () => {
    let projectile: ProjectileDraft | undefined;
    const context = combatContext({
      addProjectile: (draft) => {
        projectile = draft;
      },
    });

    const fired = ABILITY_DEFINITIONS.primary.fire(context, new THREE.Vector3(10, 0, 0));

    expect(fired).toBe(true);
    expect(projectile).toMatchObject({
      collisionLayer: 1,
      life: WEAPON_BALANCE.primary.projectileLife,
      damage: WEAPON_BALANCE.primary.damage,
      radius: WEAPON_BALANCE.primary.projectileRadius,
    });
    expect(projectile?.position.x).toBeCloseTo(WEAPON_BALANCE.primary.spawnOffset);
    expect(projectile?.position.y).toBeCloseTo(WEAPON_BALANCE.primary.spawnHeight);
    expect(projectile?.velocity.length()).toBeCloseTo(WEAPON_BALANCE.primary.projectileSpeed);
    expect(context.view.createProjectileView).not.toHaveBeenCalled();
    expect(context.resources.ammo).toBe(80 - WEAPON_BALANCE.primary.ammoCost);
  });

  it("nova damages only living enemies in the same collision layer and radius", () => {
    const closeSameLayer = enemyAt(1, 2, 0, 1);
    const farSameLayer = enemyAt(2, 8, 0, 1);
    const closeOtherLayer = enemyAt(3, 2, 0, 2);
    const deadSameLayer = { ...enemyAt(4, 2, 0, 1), deathTimer: 0.2 };
    const damageEnemy = vi.fn();
    const context = combatContext({
      enemies: [closeSameLayer, farSameLayer, closeOtherLayer, deadSameLayer],
      damageEnemy,
    });

    const fired = ABILITY_DEFINITIONS.nova.fire(context, new THREE.Vector3());

    expect(fired).toBe(true);
    expect(damageEnemy).toHaveBeenCalledOnce();
    expect(damageEnemy).toHaveBeenCalledWith(closeSameLayer, WEAPON_BALANCE.nova.damage, true);
    expect(closeSameLayer.position.x).toBeCloseTo(2 + WEAPON_BALANCE.nova.pushDistance);
    expect(context.resources.energy).toBe(100 - WEAPON_BALANCE.nova.energyCost);
  });
});
