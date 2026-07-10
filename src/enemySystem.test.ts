import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { ENEMY_BALANCE } from "./balance";
import { distance2D } from "./collision";
import { TILE_SIZE } from "./constants";
import { EventQueue } from "./eventQueue";
import { EnemySystem } from "./enemySystem";
import type { GameEffect } from "./gameEffects";
import { key, tileToWorld, type LevelData, type TileCoord } from "./level";
import { seededRandom } from "./rng";

function levelWithWalkable(tiles: TileCoord[], id = 2, spawnPoints: TileCoord[] = []): LevelData {
  return {
    mapDepth: id,
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
  playerPosition = new THREE.Vector3(),
  rng = seededRandom("enemy-system-test"),
  effects: GameEffect[] = [],
): EnemySystem {
  return new EnemySystem(
    (effect) => effects.push(effect),
    new EventQueue(),
    { position: playerPosition, radius: 0.55, collisionLayer: level.mapDepth },
    () => playerPosition,
    () => level,
    () => level.mapDepth,
    () => true,
    rng,
  );
}

describe("EnemySystem ranged attacks", () => {
  it("fires a windup projectile that can damage the player", () => {
    const events = new EventQueue();
    const effects: GameEffect[] = [];
    const level = levelWithWalkable(
      Array.from({ length: 12 }, (_, y) => y).flatMap((y) =>
        Array.from({ length: 12 }, (_, x) => ({ x, y })),
      ),
    );
    const playerPosition = tileToWorld({ x: 6, y: 6 });

    const system = new EnemySystem(
      (effect) => effects.push(effect),
      events,
      { position: playerPosition, radius: 0.55, collisionLayer: 2 },
      () => playerPosition,
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
    expect(effects.some((effect) => effect.type === "projectileImpact")).toBe(true);
  });
});

describe("EnemySystem spawning and activation", () => {
  it("spreads level spawns across the available map", () => {
    const tiles = squareTiles(45);
    const level = levelWithWalkable(tiles, 1, tiles);
    const playerPosition = tileToWorld({ x: 22, y: 22 });
    const system = createEnemySystem(level, playerPosition, seededRandom("spread-spawn-test"));

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
    const playerPosition = tileToWorld({ x: 22, y: 22 });
    const system = createEnemySystem(level, playerPosition, () => 0.5);
    const farSpawn = playerPosition.clone().add(new THREE.Vector3(ENEMY_BALANCE.activationDistance + TILE_SIZE, 0, 0));

    system.spawnEnemyAt("leanHunter", farSpawn);
    const before = system.all[0].position.clone();

    system.update(1);

    expect(distance2D(system.all[0].position, before)).toBeCloseTo(0);
    expect(system.all[0].path).toBeUndefined();
  });

  it("emits a dramatic death effect once when an enemy enters death animation", () => {
    const effects: GameEffect[] = [];
    const level = levelWithWalkable(squareTiles(12), 1);
    const playerPosition = tileToWorld({ x: 6, y: 6 });
    const system = createEnemySystem(level, playerPosition, () => 0.5, effects);
    system.spawnEnemyAt("leanHunter", playerPosition.clone().add(new THREE.Vector3(2.4, 0, 0)));

    system.damageEnemy(system.all[0], 999, false);
    system.update(1 / 60);
    system.update(1 / 60);

    expect(effects.filter((effect) => effect.type === "enemyDeath")).toHaveLength(1);
  });

  it("steers melee enemies apart while they pursue the player", () => {
    const level = levelWithWalkable(squareTiles(20), 1);
    const playerPosition = tileToWorld({ x: 10, y: 10 });
    const system = createEnemySystem(level, playerPosition, () => 0.5);

    system.spawnEnemyAt("leanHunter", playerPosition.clone().add(new THREE.Vector3(0, 0, 5.4)));
    system.spawnEnemyAt("leanHunter", playerPosition.clone().add(new THREE.Vector3(0.8, 0, 5.4)));
    const startDistance = distance2D(system.all[0].position, system.all[1].position);
    const startPlayerDistances = system.all.map((enemy) => distance2D(enemy.position, playerPosition));

    system.update(0.2);

    expect(distance2D(system.all[0].position, system.all[1].position)).toBeGreaterThan(startDistance);
    expect(system.all[0].position.z).toBeLessThan(playerPosition.z + startPlayerDistances[0]);
    expect(system.all[1].position.z).toBeLessThan(playerPosition.z + startPlayerDistances[1]);
  });

  it("keeps a strafing enemy's collision radius clear of corridor walls", () => {
    const tiles = Array.from({ length: 7 }, (_, index) => ({ x: 18 + index, y: 22 }));
    const level = levelWithWalkable(tiles, 2);
    const playerPosition = tileToWorld({ x: 20, y: 22 });
    const system = createEnemySystem(level, playerPosition, () => 0.5);
    system.spawnEnemyAt("venomSpitter", playerPosition.clone().add(new THREE.Vector3(5.2, 0, 0)));
    const enemy = system.all[0];

    for (let step = 0; step < 20; step += 1) system.update(0.1);

    const corridorCenterZ = tileToWorld({ x: 20, y: 22 }).z;
    expect(Math.abs(enemy.position.z - corridorCenterZ)).toBeGreaterThan(0.2);
    expect(Math.abs(enemy.position.z - corridorCenterZ)).toBeLessThanOrEqual(
      TILE_SIZE * 0.5 - enemy.radius + 0.0001,
    );
  });

  it("enters steering recovery after failing to make progress against a wall", () => {
    const spawn = tileToWorld({ x: 22, y: 22 });
    const level = levelWithWalkable([{ x: 22, y: 22 }], 2);
    const playerPosition = spawn.clone().add(new THREE.Vector3(4, 0, 0));
    const system = createEnemySystem(level, playerPosition, () => 0.5);
    system.spawnEnemyAt("leanHunter", spawn);
    const enemy = system.all[0];
    let observedRecovery = false;

    for (let step = 0; step < 40; step += 1) {
      system.update(0.1);
      observedRecovery ||= (enemy.steeringRecoveryTimer ?? 0) > 0;
    }

    expect(observedRecovery).toBe(true);
    expect(enemy.position.x - spawn.x).toBeLessThanOrEqual(TILE_SIZE * 0.5 - enemy.radius + 0.0001);
  });
});
