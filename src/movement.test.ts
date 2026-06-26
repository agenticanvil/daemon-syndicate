import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { key, tileToWorld, type LevelData, type TileCoord } from "./level";
import { moveOnWalkableLevel } from "./movement";

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

describe("moveOnWalkableLevel", () => {
  it("moves fully when the destination tile is walkable", () => {
    const level = levelWithWalkable([
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ]);
    const position = tileToWorld({ x: 2, y: 2 });

    const moved = moveOnWalkableLevel(level, position, new THREE.Vector3(1, 0, 0), 2.4);

    expect(moved).toBe(true);
    expect(position.x).toBeCloseTo(tileToWorld({ x: 3, y: 2 }).x);
    expect(position.z).toBeCloseTo(tileToWorld({ x: 3, y: 2 }).z);
  });

  it("falls back to axis movement when diagonal movement is blocked", () => {
    const level = levelWithWalkable([
      { x: 2, y: 2 },
      { x: 3, y: 2 },
    ]);
    const position = tileToWorld({ x: 2, y: 2 });

    const moved = moveOnWalkableLevel(level, position, new THREE.Vector3(1, 0, 1), 2.4);

    expect(moved).toBe(true);
    expect(position.x).toBeCloseTo(tileToWorld({ x: 3, y: 2 }).x);
    expect(position.z).toBeCloseTo(tileToWorld({ x: 3, y: 2 }).z);
  });

  it("refuses movement when both axis fallbacks are blocked", () => {
    const level = levelWithWalkable([{ x: 2, y: 2 }]);
    const position = tileToWorld({ x: 2, y: 2 });
    const original = position.clone();

    const moved = moveOnWalkableLevel(level, position, new THREE.Vector3(1, 0, 1), 2.4);

    expect(moved).toBe(false);
    expect(position.x).toBeCloseTo(original.x);
    expect(position.z).toBeCloseTo(original.z);
  });
});
