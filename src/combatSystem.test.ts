import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { CombatSystem, findProjectileWallImpact } from "./combatSystem";
import { createHeadlessGameplayView } from "./gameView";
import { key, tileToWorld, type LevelData, type TileCoord } from "./level";
import type { Enemy, PlayerResources } from "./types";
import { createUpgradeRanks, derivePlayerStats } from "./upgrades";

function levelWithWalkable(tiles: TileCoord[]): LevelData {
  return {
    id: 1,
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
    const view = createHeadlessGameplayView();
    const spawnProjectileImpact = vi.fn();
    view.spawnProjectileImpact = spawnProjectileImpact;
    view.player.position.set(0, 0, 0);

    const resources: PlayerResources = { health: 100, ammo: 10, energy: 100 };
    const enemy: Enemy = {
      id: 1,
      kind: "leanHunter",
      enemyLevel: 1,
      position: new THREE.Vector3(1.2, 0, 0),
      facingYaw: 0,
      collisionLayer: 1,
      hp: 10,
      speed: 0,
      xpReward: 0,
      radius: 0.48,
      attack: { kind: "melee", range: 1, damage: 1, cooldown: 1 },
      dropTable: { chance: 0, entries: [] },
      attackTimer: 0,
    };
    const level = levelWithWalkable(Array.from({ length: 45 }, (_, y) => y).flatMap((y) =>
      Array.from({ length: 45 }, (_, x) => ({ x, y })),
    ));
    const combat = new CombatSystem(
      view,
      resources,
      { position: view.player.position, radius: 0.55, collisionLayer: 1 },
      () => 1,
      () => level,
      () => derivePlayerStats(createUpgradeRanks()),
      () => [enemy],
      (target, amount) => {
        target.hp -= amount;
      },
    );

    combat.firePrimary(new THREE.Vector3(10, 0, 0));
    combat.updateProjectiles(0.02);

    expect(spawnProjectileImpact).toHaveBeenCalledTimes(1);
    expect(spawnProjectileImpact.mock.calls[0][0]).toBeInstanceOf(THREE.Vector3);
    expect(spawnProjectileImpact.mock.calls[0][1]).toBeInstanceOf(THREE.Vector3);
  });
});
