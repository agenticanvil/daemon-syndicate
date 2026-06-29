import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { ENEMY_BALANCE } from "./balance";
import { distance2D } from "./collision";
import { TILE_SIZE } from "./constants";
import { EventQueue } from "./eventQueue";
import { EnemySystem } from "./enemySystem";
import { createHeadlessGameplayView } from "./gameView";
import { key, tileToWorld, type LevelData, type TileCoord } from "./level";
import { seededRandom } from "./rng";

function levelWithWalkable(tiles: TileCoord[], id = 2, spawnPoints: TileCoord[] = []): LevelData {
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
    spawnPoints,
  };
}

function squareTiles(size: number): TileCoord[] {
  return Array.from({ length: size }, (_, y) => y).flatMap((y) =>
    Array.from({ length: size }, (_, x) => ({ x, y })),
  );
}

function createEnemySystem(
  level: LevelData,
  view = createHeadlessGameplayView(),
  rng = seededRandom("enemy-system-test"),
): EnemySystem {
  return new EnemySystem(
    view,
    new EventQueue(),
    { position: view.player.position, radius: 0.55, collisionLayer: level.id },
    () => level,
    () => level.id,
    () => true,
    rng,
  );
}

describe("EnemySystem ranged attacks", () => {
  it("fires a windup projectile that can damage the player", () => {
    const view = createHeadlessGameplayView();
    const events = new EventQueue();
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

    let damageEvent = events.drain().find((event) => event.type === "playerDamaged");
    for (let i = 0; i < 50 && !damageEvent; i += 1) {
      system.update(1 / 60);
      damageEvent = events.drain().find((event) => event.type === "playerDamaged");
    }

    expect(damageEvent).toMatchObject({ type: "playerDamaged" });
    expect(view.spawnProjectileImpact).toHaveBeenCalled();
  });
});

describe("EnemySystem spawning and activation", () => {
  it("spreads level spawns across the available map", () => {
    const tiles = squareTiles(45);
    const level = levelWithWalkable(tiles, 1, tiles);
    const view = createHeadlessGameplayView();
    view.player.position.copy(tileToWorld({ x: 22, y: 22 }));
    const system = createEnemySystem(level, view, seededRandom("spread-spawn-test"));

    system.spawnLevelEnemies();

    const positions = system.all.map((enemy) => enemy.position);
    const xs = positions.map((position) => position.x);
    const zs = positions.map((position) => position.z);
    const nearestNeighborDistances = positions.map((position, index) =>
      Math.min(...positions.filter((_, otherIndex) => otherIndex !== index).map((other) => distance2D(position, other))),
    );

    expect(positions.length).toBeGreaterThan(8);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(TILE_SIZE * 20);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(TILE_SIZE * 20);
    expect(Math.min(...nearestNeighborDistances)).toBeGreaterThan(TILE_SIZE * 3);
  });

  it("keeps enemies idle until the player is near the activation distance", () => {
    const level = levelWithWalkable(squareTiles(45));
    const view = createHeadlessGameplayView();
    view.player.position.copy(tileToWorld({ x: 22, y: 22 }));
    const system = createEnemySystem(level, view, () => 0.5);
    const farSpawn = view.player.position.clone().add(new THREE.Vector3(ENEMY_BALANCE.activationDistance + TILE_SIZE, 0, 0));

    system.spawnEnemyAt("leanHunter", farSpawn);
    const before = system.all[0].position.clone();

    system.update(1);

    expect(distance2D(system.all[0].position, before)).toBeCloseTo(0);
    expect(system.all[0].path).toBeUndefined();
  });
});
