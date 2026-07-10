import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { addGameplayLighting, createCorridorFixtures, hasLevelLineOfSight } from "./sceneLighting";
import { generateLevel, key, neighbors, tileToWorld, worldToTile, type LevelData } from "./level";
import { seededRandom } from "./rng";

describe("addGameplayLighting", () => {
  it("casts flashlight shadows from walls close to the player", () => {
    const scene = new THREE.Scene();
    const playerLightAnchor = new THREE.Group();

    addGameplayLighting(scene, playerLightAnchor);

    const flashlight = playerLightAnchor.children.find(
      (child): child is THREE.SpotLight => child instanceof THREE.SpotLight,
    );
    expect(flashlight).toBeDefined();
    expect(flashlight?.castShadow).toBe(true);
    expect(flashlight?.shadow.camera.near).toBeLessThan(0.2);
    expect(flashlight?.shadow.bias).toBe(-0.00005);
    expect(flashlight?.shadow.normalBias).toBe(0.001);
  });

  it("uses a fixed pool with shadows only on the closest corridor light", () => {
    const scene = new THREE.Scene();
    const lighting = addGameplayLighting(scene, new THREE.Group());
    const level = generateLevel(3, seededRandom("corridor-light-pool"));

    lighting.setLevel(level);
    const panelRoot = scene.getObjectByName("corridor-light-panels");
    expect(collectInstanceColors(panelRoot).size).toBe(1);
    lighting.update(new THREE.Vector3(), 0.1);

    const corridorLights = scene.children.filter(
      (child): child is THREE.SpotLight => child instanceof THREE.SpotLight,
    );
    expect(corridorLights).toHaveLength(3);
    expect(corridorLights.filter((light) => light.castShadow)).toHaveLength(1);
    expect(corridorLights.find((light) => light.castShadow)?.shadow.mapSize.toArray()).toEqual([512, 512]);
    expect(corridorLights.every((light) => light.angle > 1 && light.distance >= 16)).toBe(true);
    const activeLights = corridorLights.filter((light) => light.intensity > 0);
    expect(activeLights.length).toBeGreaterThan(0);
    expect(activeLights.length).toBeLessThanOrEqual(3);
    expect(activeLights.every((light) => light.intensity === 24)).toBe(true);
    expect(collectInstanceColors(panelRoot).size).toBeGreaterThan(1);

    lighting.update(new THREE.Vector3(), 0.1);
    expect(activeLights.every((light) => light.intensity === 48)).toBe(true);

    lighting.update(new THREE.Vector3(10_000, 0, 10_000), 0.2);
    expect(corridorLights.every((light) => light.intensity === 0)).toBe(true);
    expect(corridorLights.every((light) => light.castShadow === false)).toBe(true);
    expect(collectInstanceColors(panelRoot).size).toBe(1);
  });

  it("requires an unobstructed run of floor tiles for sensor line of sight", () => {
    const walkable = new Set(Array.from({ length: 5 }, (_, index) => key({ x: 20 + index, y: 22 })));
    const level = {
      mapDepth: 1,
      width: 45,
      height: 45,
      exitDirection: "east",
      start: { x: 20, y: 22 },
      end: { x: 24, y: 22 },
      walkable,
      blocked: new Set<string>(),
      environmentalObjects: [],
      spawnPoints: [],
    } satisfies LevelData;
    const from = tileToWorld(level.start);
    const to = tileToWorld(level.end);

    expect(hasLevelLineOfSight(level, from, to)).toBe(true);
    walkable.delete(key({ x: 22, y: 22 }));
    expect(hasLevelLineOfSight(level, from, to)).toBe(false);
  });

  it("spaces a bounded deterministic set of fixtures across wall segments", () => {
    const level = generateLevel(4, seededRandom("corridor-fixtures"));
    const first = createCorridorFixtures(level);
    const second = createCorridorFixtures(level);

    expect(first.length).toBeGreaterThan(8);
    expect(first.length).toBeLessThanOrEqual(32);
    expect(first.map((fixture) => fixture.position.toArray())).toEqual(
      second.map((fixture) => fixture.position.toArray()),
    );
    for (const fixture of first) {
      const ownerTile = worldToTile(fixture.position);
      expect(level.walkable.has(key(ownerTile))).toBe(true);
      expect(neighbors(ownerTile).some((neighbor) => !level.walkable.has(key(neighbor)))).toBe(true);
      expect(fixture.position.y).toBeLessThan(2);
    }
  });
});

function collectInstanceColors(root: THREE.Object3D | undefined): Set<string> {
  const colors = new Set<string>();
  root?.traverse((object) => {
    if (!(object instanceof THREE.InstancedMesh) || !object.instanceColor) return;
    for (let index = 0; index < object.instanceColor.count; index += 1) {
      colors.add(
        [object.instanceColor.getX(index), object.instanceColor.getY(index), object.instanceColor.getZ(index)]
          .map((value) => value.toFixed(4))
          .join(","),
      );
    }
  });
  return colors;
}
