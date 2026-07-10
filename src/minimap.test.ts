import { describe, expect, it } from "vitest";
import { key, type LevelData } from "./level";
import { minimapWallEdges, revealMinimapTiles } from "./minimap";

describe("revealMinimapTiles", () => {
  it("reveals nearby walkable tiles without exposing distant or void tiles", () => {
    const level = testLevel();
    const explored = new Set<string>();

    revealMinimapTiles(level, { x: 4, y: 4 }, explored, 2);

    expect(explored.has(key({ x: 4, y: 4 }))).toBe(true);
    expect(explored.has(key({ x: 6, y: 4 }))).toBe(true);
    expect(explored.has(key({ x: 6, y: 6 }))).toBe(false);
    expect(explored.has(key({ x: 4, y: 3 }))).toBe(false);
  });

  it("preserves previously explored tiles as the player moves", () => {
    const level = testLevel();
    const explored = new Set<string>();

    revealMinimapTiles(level, { x: 2, y: 2 }, explored, 1);
    revealMinimapTiles(level, { x: 7, y: 7 }, explored, 1);

    expect(explored.has(key({ x: 2, y: 2 }))).toBe(true);
    expect(explored.has(key({ x: 7, y: 7 }))).toBe(true);
  });

  it("outlines void boundaries while leaving walkable connections open", () => {
    const level = testLevel();

    expect(minimapWallEdges(level, { x: 4, y: 4 })).toContain("north");
    expect(minimapWallEdges(level, { x: 5, y: 4 })).not.toContain("north");
  });

  it("leaves the two-tile exit gap open", () => {
    const level = testLevel();
    level.walkable.delete(key({ x: 9, y: 8 }));
    level.walkable.delete(key({ x: 9, y: 9 }));
    level.end = { x: 8, y: 8 };

    expect(minimapWallEdges(level, { x: 8, y: 8 })).not.toContain("east");
    expect(minimapWallEdges(level, { x: 8, y: 9 })).not.toContain("east");
  });
});

function testLevel(): LevelData {
  const walkable = new Set<string>();
  for (let y = 0; y < 10; y += 1) {
    for (let x = 0; x < 10; x += 1) {
      walkable.add(key({ x, y }));
    }
  }
  walkable.delete(key({ x: 4, y: 3 }));

  return {
    mapDepth: 1,
    width: 10,
    height: 10,
    exitDirection: "east",
    start: { x: 1, y: 1 },
    end: { x: 8, y: 8 },
    walkable,
    blocked: new Set(),
    environmentalObjects: [],
    spawnPoints: [],
  };
}
