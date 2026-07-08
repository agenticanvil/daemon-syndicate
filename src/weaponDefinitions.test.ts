import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { WEAPON_BALANCE } from "./balance";
import { PLAYER_MAX } from "./constants";
import type { GameEffect } from "./gameEffects";
import { ABILITY_DEFINITIONS, type CombatContext } from "./weaponDefinitions";
import type { PlayerResources } from "./resourceTypes";
import type { ProjectileDraft } from "./projectileTypes";
import { createUpgradeRanks, derivePlayerStats } from "./upgrades";

function combatContext(overrides: Partial<CombatContext> = {}): CombatContext {
  const resources: PlayerResources = { ...PLAYER_MAX };
  const playerPosition = new THREE.Vector3(0, 0, 0);
  return {
    resources,
    playerPosition,
    playerCollisionBody: {
      position: playerPosition,
      radius: 0.55,
      collisionLayer: 1,
    },
    collisionLayer: 1,
    enemies: [],
    stats: derivePlayerStats(createUpgradeRanks()),
    damageEnemy: vi.fn(),
    addProjectile: vi.fn(),
    emitEffect: vi.fn(),
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
      stats: {
        ...derivePlayerStats(createUpgradeRanks()),
        primaryDamage: WEAPON_BALANCE.primary.damage + 10,
      },
    });

    const fired = ABILITY_DEFINITIONS.primary.fire(context, new THREE.Vector3(10, 0, 0));

    expect(fired).toBe(true);
    expect(projectile).toMatchObject({
      collisionLayer: 1,
      life: WEAPON_BALANCE.primary.projectileLife,
      damage: WEAPON_BALANCE.primary.damage + 10,
      radius: WEAPON_BALANCE.primary.projectileRadius,
      pierceRemaining: 0,
    });
    expect(projectile?.position.x).toBeCloseTo(WEAPON_BALANCE.primary.spawnOffset);
    expect(projectile?.position.y).toBeCloseTo(WEAPON_BALANCE.primary.spawnHeight);
    expect(projectile?.position.z).toBeCloseTo(WEAPON_BALANCE.primary.muzzleSideOffset);
    expect(projectile?.velocity.length()).toBeCloseTo(WEAPON_BALANCE.primary.projectileSpeed);
    expect(projectile?.velocity.z).toBeLessThan(0);
    expect(context.resources.ammo).toBe(PLAYER_MAX.ammo - WEAPON_BALANCE.primary.ammoCost);
  });

  it("keeps close-range primary shots traveling toward the aim direction", () => {
    let projectile: ProjectileDraft | undefined;
    const context = combatContext({
      addProjectile: (draft) => {
        projectile = draft;
      },
    });

    const fired = ABILITY_DEFINITIONS.primary.fire(context, new THREE.Vector3(0.2, 0, 0));

    expect(fired).toBe(true);
    expect(projectile?.velocity.x).toBeGreaterThan(0);
  });

  it("nova emits an upgraded-radius pulse and spends energy", () => {
    const damageEnemy = vi.fn();
    const effects: GameEffect[] = [];
    const upgradedStats = {
      ...derivePlayerStats(createUpgradeRanks()),
      novaDamage: WEAPON_BALANCE.nova.damage + 8,
      novaRadius: WEAPON_BALANCE.nova.radius + 0.6,
    };
    const context = combatContext({
      stats: upgradedStats,
      damageEnemy,
      emitEffect: (effect) => effects.push(effect),
    });

    const fired = ABILITY_DEFINITIONS.nova.fire(context, new THREE.Vector3());

    expect(fired).toBe(true);
    expect(damageEnemy).not.toHaveBeenCalled();
    expect(effects).toEqual([{ type: "nova", position: context.playerPosition, radius: upgradedStats.novaRadius }]);
    expect(context.resources.energy).toBe(100 - WEAPON_BALANCE.nova.energyCost);
  });
});
