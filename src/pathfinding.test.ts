import { describe, expect, it } from "vitest";
import { findPath } from "./pathfinding";
import { key, type LevelData, type TileCoord } from "./level";

function levelWithWalkable(tiles: TileCoord[]): LevelData {
  return {
    id: 1,
    width: 5,
    height: 5,
    exitDirection: "north",
    start: tiles[0],
    end: tiles[tiles.length - 1],
    walkable: new Set(tiles.map(key)),
    spawnPoints: [],
  };
}

describe("findPath", () => {
  it("finds a path between walkable tiles", () => {
    const level = levelWithWalkable([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ]);

    expect(findPath(level, { x: 1, y: 1 }, { x: 3, y: 1 })).toEqual(["2,1", "3,1"]);
  });

  it("returns undefined when the target is unreachable", () => {
    const level = levelWithWalkable([
      { x: 1, y: 1 },
      { x: 3, y: 1 },
    ]);

    expect(findPath(level, { x: 1, y: 1 }, { x: 3, y: 1 })).toBeUndefined();
  });

  it("returns an empty path when start equals target", () => {
    const level = levelWithWalkable([{ x: 2, y: 2 }]);

    expect(findPath(level, { x: 2, y: 2 }, { x: 2, y: 2 })).toEqual([]);
  });
});
