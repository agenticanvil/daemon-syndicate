import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { PLAYER_RADIUS, TILE_SIZE } from "./constants";
import { GameSimulation } from "./gameSimulation";
import { key, tileToWorld, type LevelData } from "./level";
import { idlePlayerCommand } from "./playerCommand";

describe("GameSimulation", () => {
  it("can start a new run on a requested map depth", () => {
    const simulation = new GameSimulation();

    simulation.startNewRun({ mapDepth: 5 });

    expect(simulation.snapshot().mapDepth).toBe(5);
  });

  it("clamps invalid start map depths to the first map", () => {
    const simulation = new GameSimulation();

    simulation.startNewRun({ mapDepth: 0 });

    expect(simulation.snapshot().mapDepth).toBe(1);
  });

  it("stops combat and enemy processing on the level-transition step", () => {
    const simulation = new GameSimulation({
      rng: () => 0.5,
      createLevel: transitionTestLevel,
    });
    simulation.startNewRun();
    const resourcesBefore = { ...simulation.snapshot().player.resources };

    const result = simulation.step(0.08, {
      movement: new THREE.Vector3(1, 0, 0),
      aimWorld: tileToWorld({ x: 4, y: 3 }),
      firePrimary: true,
      fireNova: true,
      dash: false,
    });
    const snapshot = simulation.snapshot();

    expect(result.mapDepthChanged).toBe(true);
    expect(result.primaryFired).toBe(false);
    expect(result.novaFired).toBe(false);
    expect(snapshot.mapDepth).toBe(2);
    expect(snapshot.player.resources).toEqual(resourcesBefore);
    expect(snapshot.combat.projectiles).toEqual([]);
    expect(snapshot.combat.abilityTimers).toEqual({ primary: 0, nova: 0 });
    expect(snapshot.enemies.length).toBeGreaterThan(0);
    expect(snapshot.enemies.every((enemy) => enemy.attackTimer === 0)).toBe(true);
  });

  it("freezes simulation state while paused and resumes normal stepping", () => {
    const simulation = createLifecycleSimulation();
    simulation.startNewRun();
    const beforePause = simulation.snapshot();
    simulation.setPaused(true);

    const pausedResult = simulation.step(0.5, {
      movement: new THREE.Vector3(1, 0, 0),
      aimWorld: tileToWorld({ x: 8, y: 3 }),
      firePrimary: true,
      fireNova: true,
      dash: true,
    });
    const whilePaused = simulation.snapshot();

    expect(pausedResult).toMatchObject({
      primaryFired: false,
      novaFired: false,
      dashUsed: false,
      mapDepthChanged: false,
      gameOver: false,
    });
    expect(whilePaused.player).toEqual(beforePause.player);
    expect(whilePaused.enemies).toEqual(beforePause.enemies);
    expect(whilePaused.combat).toEqual(beforePause.combat);
    expect(whilePaused.pickups).toEqual(beforePause.pickups);

    simulation.setPaused(false);
    const resumedResult = simulation.step(0.1, {
      ...idlePlayerCommand(simulation.playerPosition),
      aimWorld: tileToWorld({ x: 8, y: 3 }),
      firePrimary: true,
    });

    expect(resumedResult.primaryFired).toBe(true);
    expect(simulation.snapshot().player.resources.ammo).toBe(beforePause.player.resources.ammo - 1);
  });

  it("keeps the player collision radius clear of corridor walls", () => {
    const simulation = new GameSimulation({
      rng: () => 0,
      createLevel: corridorTestLevel,
    });
    simulation.startNewRun();
    const start = simulation.playerPosition.clone();

    for (let step = 0; step < 20; step += 1) {
      simulation.step(0.01, {
        ...idlePlayerCommand(simulation.playerPosition),
        movement: new THREE.Vector3(0, 0, 1),
      });
    }

    expect(simulation.playerPosition.z - start.z).toBeGreaterThan(0.4);
    expect(simulation.playerPosition.z - start.z).toBeLessThanOrEqual(TILE_SIZE * 0.5 - PLAYER_RADIUS + 0.0001);
  });

  it("stops stepping after game over and restores a clean run on restart", () => {
    const simulation = createLifecycleSimulation();
    simulation.startNewRun();
    simulation.spawnEnemy("leanHunter", simulation.playerPosition.clone());

    for (let step = 0; step < 20 && !simulation.isGameOver; step += 1) {
      simulation.step(1);
    }
    const gameOverSnapshot = simulation.snapshot();

    expect(gameOverSnapshot.gameOver).toBe(true);
    expect(gameOverSnapshot.player.resources.health).toBe(0);

    simulation.step(1, {
      ...idlePlayerCommand(simulation.playerPosition),
      movement: new THREE.Vector3(1, 0, 0),
      firePrimary: true,
    });
    expect(simulation.snapshot()).toEqual(gameOverSnapshot);

    simulation.startNewRun({ mapDepth: 3 });
    const restarted = simulation.snapshot();
    expect(restarted).toMatchObject({
      started: true,
      paused: false,
      gameOver: false,
      kills: 0,
      mapDepth: 3,
    });
    expect(restarted.player.resources).toEqual(restarted.player.maxResources);
    expect(restarted.enemies).toEqual([]);
    expect(restarted.combat.projectiles).toEqual([]);
    expect(restarted.pickups).toEqual([]);
  });

  it("can disable player damage for dev traversal", () => {
    const simulation = createLifecycleSimulation();
    simulation.startNewRun();
    simulation.setDebugInvulnerable(true);
    simulation.spawnEnemy("leanHunter", simulation.playerPosition.clone());

    for (let step = 0; step < 20; step += 1) {
      simulation.step(1);
    }

    const snapshot = simulation.snapshot();
    expect(snapshot.gameOver).toBe(false);
    expect(snapshot.player.resources.health).toBe(snapshot.player.maxResources.health);
    expect(snapshot.player.debugInvulnerable).toBe(true);
  });

  it("clears active entities on main-menu exit and ignores commands until redeployment", () => {
    const simulation = createLifecycleSimulation();
    simulation.startNewRun();
    simulation.spawnEnemy("leanHunter", simulation.playerPosition.clone().add(new THREE.Vector3(1, 0, 0)));
    const novaResult = simulation.step(0, {
      ...idlePlayerCommand(simulation.playerPosition),
      fireNova: true,
    });
    expect(novaResult.novaFired).toBe(true);
    simulation.step(0.6);
    expect(simulation.snapshot().pickups.length).toBeGreaterThan(0);

    simulation.spawnEnemy("leanHunter", simulation.playerPosition.clone().add(new THREE.Vector3(4, 0, 0)));
    simulation.step(0.01, {
      ...idlePlayerCommand(simulation.playerPosition),
      aimWorld: simulation.playerPosition.clone().add(new THREE.Vector3(8, 0, 0)),
      firePrimary: true,
    });
    expect(simulation.snapshot().enemies.length).toBeGreaterThan(0);

    simulation.exitToMainMenu();
    const mainMenu = simulation.snapshot();

    expect(mainMenu).toMatchObject({ started: false, paused: false, gameOver: false });
    expect(mainMenu.enemies).toEqual([]);
    expect(mainMenu.enemyProjectiles).toEqual([]);
    expect(mainMenu.combat.projectiles).toEqual([]);
    expect(mainMenu.pickups).toEqual([]);

    simulation.step(1, {
      ...idlePlayerCommand(simulation.playerPosition),
      movement: new THREE.Vector3(1, 0, 0),
      firePrimary: true,
    });
    expect(simulation.snapshot()).toEqual(mainMenu);
  });

  it("spends earned upgrade points and resets progression and resources on a new run", () => {
    const simulation = createLifecycleSimulation();
    simulation.startNewRun();
    simulation.grantResources({ health: -40, ammo: -60, energy: -30 });
    expect(simulation.grantXp(100)).toBe(1);
    expect(simulation.progressionHudState.unspentUpgradePoints).toBe(1);
    expect(simulation.availableUpgrades.some((option) => option.id === "maxHealth")).toBe(true);

    expect(simulation.spendUpgrade("maxHealth")).toBe(true);
    const upgraded = simulation.snapshot();
    expect(upgraded.progression.upgrades.maxHealth).toBe(1);
    expect(upgraded.progression.unspentUpgradePoints).toBe(0);
    expect(upgraded.player.maxResources.health).toBe(120);
    expect(upgraded.player.resources.health).toBe(80);

    simulation.startNewRun();
    const restarted = simulation.snapshot();
    expect(restarted.progression).toMatchObject({
      level: 1,
      xp: 0,
      unspentUpgradePoints: 0,
    });
    expect(Object.values(restarted.progression.upgrades).every((rank) => rank === 0)).toBe(true);
    expect(restarted.player.resources).toEqual(restarted.player.maxResources);
    expect(restarted.player.maxResources.health).toBe(100);
  });
});

function createLifecycleSimulation(): GameSimulation {
  return new GameSimulation({
    rng: () => 0,
    createLevel: openTestLevel,
  });
}

function openTestLevel(mapDepth: number): LevelData {
  const walkable = new Set<string>();
  for (let y = 0; y < 45; y += 1) {
    for (let x = 0; x < 45; x += 1) {
      walkable.add(key({ x, y }));
    }
  }
  return {
    mapDepth,
    width: 45,
    height: 45,
    exitDirection: "east",
    start: { x: 3, y: 3 },
    end: { x: 40, y: 40 },
    walkable,
    blocked: new Set(),
    environmentalObjects: [],
    spawnPoints: [],
  };
}

function transitionTestLevel(mapDepth: number): LevelData {
  const start = { x: 3, y: 3 };
  const enemySpawn = { x: 20, y: 20 };
  return {
    mapDepth,
    width: 45,
    height: 45,
    exitDirection: "east",
    start,
    end: { ...start },
    walkable: new Set([key(start), key(enemySpawn)]),
    blocked: new Set(),
    environmentalObjects: [],
    spawnPoints: [enemySpawn],
  };
}

function corridorTestLevel(mapDepth: number): LevelData {
  const tiles = Array.from({ length: 5 }, (_, index) => ({ x: 20 + index, y: 22 }));
  return {
    mapDepth,
    width: 45,
    height: 45,
    exitDirection: "east",
    start: tiles[2],
    end: tiles[4],
    walkable: new Set(tiles.map(key)),
    blocked: new Set(),
    environmentalObjects: [],
    spawnPoints: [],
  };
}
