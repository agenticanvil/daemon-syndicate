import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { EventQueue } from "./eventQueue";
import { EnemySystem } from "./enemySystem";
import { createHeadlessGameplayView } from "./gameView";
import { key, tileToWorld, type LevelData, type TileCoord } from "./level";
import type { PlayerResources } from "./types";

function levelWithWalkable(tiles: TileCoord[], id = 2): LevelData {
  return {
    id,
    width: 12,
    height: 12,
    exitDirection: "north",
    start: tiles[0],
    end: tiles[tiles.length - 1],
    walkable: new Set(tiles.map(key)),
    blocked: new Set(),
    environmentalObjects: [],
    spawnPoints: [],
  };
}

describe("EnemySystem ranged attacks", () => {
  it("fires a windup projectile that can damage the player", () => {
    const view = createHeadlessGameplayView();
    const events = new EventQueue();
    const resources: PlayerResources = { health: 100, ammo: 10, energy: 10 };
    const level = levelWithWalkable(
      Array.from({ length: 12 }, (_, y) => y).flatMap((y) =>
        Array.from({ length: 12 }, (_, x) => ({ x, y })),
      ),
    );
    const playerPosition = tileToWorld({ x: 6, y: 6 });
    view.player.position.copy(playerPosition);
    view.spawnProjectileImpact = vi.fn();

    const system = new EnemySystem(
      view,
      events,
      { position: view.player.position, radius: 0.55, collisionLayer: 2 },
      resources,
      () => level,
      () => 2,
      () => true,
      () => 0.5,
    );

    system.spawnEnemyAt("venomSpitter", playerPosition.clone().add(new THREE.Vector3(5.2, 0, 0)));
    system.update(0.12);
    expect(system.projectileCount).toBe(0);

    system.update(0.3);
    expect(system.projectileCount).toBe(1);

    for (let i = 0; i < 50 && resources.health === 100; i += 1) {
      system.update(1 / 60);
    }

    expect(resources.health).toBeLessThan(100);
    expect(view.spawnProjectileImpact).toHaveBeenCalled();
  });
});
