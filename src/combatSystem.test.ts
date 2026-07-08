import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { CombatSystem, findProjectileWallImpact } from "./combatSystem";
import { WEAPON_BALANCE } from "./balance";
import type { GameEffect } from "./gameEffects";
import { key, tileToWorld, type LevelData, type TileCoord } from "./level";
import type { PlayerResources } from "./resourceTypes";
import type { Enemy } from "./enemyTypes";
import { createUpgradeRanks, derivePlayerStats } from "./upgrades";

function levelWithWalkable(tiles: TileCoord[]): LevelData {
  return {
    mapDepth: 1,
    width: 5,
    height: 5,
    exitDirection: "north",
    start: tiles[0],
    end: tiles[tiles.length - 1],
    walkable: new Set(tiles.map(key)),
    blocked: new Set(),
    environmentalObjects: [],
    spawnPoints: [],
  };
}

function enemyAt(id: number, x: number, z: number, collisionLayer = 1): Enemy {
  return {
    id,
    kind: "leanHunter",
    enemyLevel: 1,
    position: new THREE.Vector3(x, 0, z),
    facingYaw: 0,
    collisionLayer,
    health: 100,
    speed: 0,
    xpReward: 0,
    radius: 0.48,
    attack: { kind: "melee", range: 1, damage: 1, cooldown: 1 },
    dropTable: { chance: 0, entries: [] },
    attackTimer: 0,
    animation: "idle",
  };
}

describe("findProjectileWallImpact", () => {
  it("does not collide while a projectile remains over platform tiles", () => {
    const level = levelWithWalkable([
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ]);

    expect(findProjectileWallImpact(level, tileToWorld({ x: 2, y: 2 }), tileToWorld({ x: 3, y: 2 }))).toBeUndefined();
  });

  it("reports an impact when a projectile leaves the platform", () => {
    const level = levelWithWalkable([{ x: 2, y: 2 }]);
    const start = tileToWorld({ x: 2, y: 2 });
    const end = start.clone().add(new THREE.Vector3(2.4, 0, 0));

    const impact = findProjectileWallImpact(level, start, end);

    expect(impact).toBeDefined();
    expect(impact?.position.x).toBeGreaterThan(start.x);
    expect(impact?.position.x).toBeLessThan(end.x);
  });

  it("detects a gap crossed within a single projectile step", () => {
    const level = levelWithWalkable([
      { x: 2, y: 2 },
      { x: 4, y: 2 },
    ]);

    const impact = findProjectileWallImpact(level, tileToWorld({ x: 2, y: 2 }), tileToWorld({ x: 4, y: 2 }));

    expect(impact).toBeDefined();
    expect(impact?.position.x).toBeLessThan(tileToWorld({ x: 4, y: 2 }).x);
  });

  it("treats blocked environmental tiles as platform, not platform edges", () => {
    const level = levelWithWalkable([
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ]);
    level.blocked.add("3,2");

    expect(findProjectileWallImpact(level, tileToWorld({ x: 2, y: 2 }), tileToWorld({ x: 3, y: 2 }))).toBeUndefined();
  });
});

describe("CombatSystem projectiles", () => {
  it("spawns a projectile impact spark when a projectile hits an enemy", () => {
    const effects: GameEffect[] = [];
    const playerPosition = new THREE.Vector3(0, 0, 0);

    const resources: PlayerResources = { health: 100, ammo: 10, energy: 100 };
    const enemy: Enemy = {
      id: 1,
      kind: "leanHunter",
      enemyLevel: 1,
      position: new THREE.Vector3(1.2, 0, 0),
      facingYaw: 0,
      collisionLayer: 1,
      health: 10,
      speed: 0,
      xpReward: 0,
      radius: 0.48,
      attack: { kind: "melee", range: 1, damage: 1, cooldown: 1 },
      dropTable: { chance: 0, entries: [] },
      attackTimer: 0,
      animation: "idle",
    };
    const level = levelWithWalkable(Array.from({ length: 45 }, (_, y) => y).flatMap((y) =>
      Array.from({ length: 45 }, (_, x) => ({ x, y })),
    ));
    const combat = new CombatSystem(
      (effect) => effects.push(effect),
      resources,
      { position: playerPosition, radius: 0.55, collisionLayer: 1 },
      () => playerPosition,
      () => 1,
      () => level,
      () => derivePlayerStats(createUpgradeRanks()),
      () => [enemy],
      (target: Enemy, amount: number) => {
        target.health -= amount;
      },
    );

    combat.firePrimary(new THREE.Vector3(10, 0, 0));
    combat.updateProjectiles(0.02);

    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ type: "projectileImpact" });
    if (effects[0].type !== "projectileImpact") throw new Error("Expected projectile impact effect");
    expect(effects[0].position).toBeInstanceOf(THREE.Vector3);
    expect(effects[0].incomingVelocity).toBeInstanceOf(THREE.Vector3);
  });
});

describe("CombatSystem nova", () => {
  it("damages enemies that enter the upgraded nova radius while the pulse is active", () => {
    const effects: GameEffect[] = [];
    const playerPosition = new THREE.Vector3(0, 0, 0);
    const resources: PlayerResources = { health: 100, ammo: 10, energy: 100 };
    const ranks = createUpgradeRanks();
    ranks.novaCapacitor = 2;
    const stats = derivePlayerStats(ranks);
    const initialEnemy = enemyAt(1, stats.novaRadius * WEAPON_BALANCE.nova.startScale - 0.1, 0);
    const enteringEnemy = enemyAt(2, stats.novaRadius + 2, 0);
    const delayedEnemy = enemyAt(3, stats.novaRadius - 0.05, 0);
    const otherLayerEnemy = enemyAt(4, 1, 0, 2);
    const enemies = [initialEnemy, enteringEnemy, delayedEnemy, otherLayerEnemy];
    const level = levelWithWalkable([{ x: 0, y: 0 }]);
    const hits: Array<{ id: number; amount: number }> = [];
    const combat = new CombatSystem(
      (effect) => effects.push(effect),
      resources,
      { position: playerPosition, radius: 0.55, collisionLayer: 1 },
      () => playerPosition,
      () => 1,
      () => level,
      () => stats,
      () => enemies,
      (target: Enemy, amount: number) => {
        hits.push({ id: target.id, amount });
        target.health -= amount;
      },
    );

    expect(combat.fireNova()).toBe(true);
    enteringEnemy.position.set(stats.novaRadius - 0.05, 0, 0);
    expect(hits).toEqual([{ id: initialEnemy.id, amount: stats.novaDamage }]);

    combat.updateProjectiles(WEAPON_BALANCE.nova.duration * 0.5);
    expect(hits).toEqual([{ id: initialEnemy.id, amount: stats.novaDamage }]);

    combat.updateProjectiles(WEAPON_BALANCE.nova.duration * 0.49);

    expect(hits).toEqual([
      { id: initialEnemy.id, amount: stats.novaDamage },
      { id: enteringEnemy.id, amount: stats.novaDamage },
      { id: delayedEnemy.id, amount: stats.novaDamage },
    ]);
    expect(effects).toEqual([{ type: "nova", position: playerPosition, radius: stats.novaRadius }]);
    expect(resources.energy).toBe(100 - WEAPON_BALANCE.nova.energyCost);
    expect(initialEnemy.position.x).toBeCloseTo(
      stats.novaRadius * WEAPON_BALANCE.nova.startScale - 0.1 + WEAPON_BALANCE.nova.pushDistance,
    );
    expect(otherLayerEnemy.health).toBe(100);
  });
});
