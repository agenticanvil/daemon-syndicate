import { describe, expect, it } from "vitest";
import { FLOOR_VARIANTS } from "./floorVariants";
import { fromKey, generateLevel, key, neighbors, type LevelData, type TileCoord } from "./level";
import { seededRandom } from "./rng";

describe("generateLevel", () => {
  it("builds larger maps with frequent dead-end branches", () => {
    const levels = Array.from({ length: 6 }, (_, index) => generateLevel(3, seededRandom(`maze-seed-${index}`)));

    for (const level of levels) {
      expect(level.width).toBe(45);
      expect(level.height).toBe(45);
    }

    const deadEndCounts = levels.map(countTerminalCaps);

    expect(Math.min(...deadEndCounts)).toBeGreaterThanOrEqual(8);
  });

  it("is deterministic with an injected seeded RNG", () => {
    const first = generateLevel(3, seededRandom("level-seed"));
    const second = generateLevel(3, seededRandom("level-seed"));

    expect({
      exitDirection: first.exitDirection,
      start: first.start,
      end: first.end,
      walkable: [...first.walkable],
      blocked: [...first.blocked],
      environmentalObjects: first.environmentalObjects,
      spawnPoints: first.spawnPoints,
    }).toEqual({
      exitDirection: second.exitDirection,
      start: second.start,
      end: second.end,
      walkable: [...second.walkable],
      blocked: [...second.blocked],
      environmentalObjects: second.environmentalObjects,
      spawnPoints: second.spawnPoints,
    });
  });

  it("varies start corners and exit sides across seeded levels", () => {
    const levels = Array.from({ length: 48 }, (_, index) => generateLevel(3, seededRandom(`route-seed-${index}`)));
    const starts = new Set(levels.map((level) => key(level.start)));
    const exitDirections = new Set(levels.map((level) => level.exitDirection));

    expect(starts.size).toBeGreaterThanOrEqual(3);
    expect(exitDirections).toEqual(new Set(["north", "east", "south", "west"]));
  });

  it("places a small set of non-blocking environmental objects", () => {
    for (let index = 0; index < 8; index += 1) {
      const level = generateLevel(3, seededRandom(`crate-seed-${index}`));

      expect(level.environmentalObjects.filter((object) => object.kind === "industrial-crate").length).toBeGreaterThanOrEqual(2);
      expect(level.environmentalObjects.filter((object) => object.kind === "industrial-crate").length).toBeLessThanOrEqual(3);
      expect(level.environmentalObjects.filter((object) => object.kind === "bio-vat")).toHaveLength(2);
      expect(isConnected(level)).toBe(true);
      for (const object of level.environmentalObjects) {
        const objectKey = `${object.tile.x},${object.tile.y}`;
        expect(level.walkable.has(objectKey)).toBe(true);
        expect(level.blocked.has(objectKey)).toBe(true);
        expect(level.spawnPoints.map((spawn) => `${spawn.x},${spawn.y}`)).not.toContain(objectKey);
      }
    }
  });

  it("assigns known floor variants to every walkable tile", () => {
    const level = generateLevel(3, seededRandom("floor-variant-seed"));
    const knownVariants = new Set<string>(FLOOR_VARIANTS.map((variant) => variant.id));

    expect(level.floorVariants?.size).toBe(level.walkable.size);
    for (const tileKey of level.walkable) {
      expect(knownVariants.has(level.floorVariants?.get(tileKey) ?? "")).toBe(true);
    }
  });

  it("does not generate one-tile-wide corridors or corner-touching platforms", () => {
    for (let index = 0; index < 24; index += 1) {
      const level = generateLevel(8, seededRandom(`platform-spacing-seed-${index}`));

      expect(findOneTileWidePassage(level)).toBeUndefined();
      expect(findCornerTouch(level)).toBeUndefined();
    }
  });
});

function findOneTileWidePassage(level: LevelData): TileCoord | undefined {
  return [...level.walkable].map(fromKey).find((tile) => {
    const hasHorizontalWidth = level.walkable.has(key({ x: tile.x - 1, y: tile.y })) || level.walkable.has(key({ x: tile.x + 1, y: tile.y }));
    const hasVerticalWidth = level.walkable.has(key({ x: tile.x, y: tile.y - 1 })) || level.walkable.has(key({ x: tile.x, y: tile.y + 1 }));
    return !hasHorizontalWidth || !hasVerticalWidth;
  });
}

function countTerminalCaps(level: LevelData): number {
  const caps = new Set<string>();

  for (const tile of [...level.walkable].map(fromKey)) {
    for (const direction of [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ]) {
      const widthDirection = direction.x === 0 ? { x: 1, y: 0 } : { x: 0, y: 1 };
      const pair = { x: tile.x + widthDirection.x, y: tile.y + widthDirection.y };
      if (!level.walkable.has(key(pair))) continue;

      const frontA = { x: tile.x + direction.x, y: tile.y + direction.y };
      const frontB = { x: pair.x + direction.x, y: pair.y + direction.y };
      const backA = { x: tile.x - direction.x, y: tile.y - direction.y };
      const backB = { x: pair.x - direction.x, y: pair.y - direction.y };
      if (level.walkable.has(key(frontA)) || level.walkable.has(key(frontB))) continue;
      if (!level.walkable.has(key(backA)) || !level.walkable.has(key(backB))) continue;

      caps.add([key(tile), key(pair), key(direction)].sort().join("|"));
    }
  }

  return caps.size;
}

function isConnected(level: LevelData): boolean {
  const startKey = key(level.start);
  const openCount = [...level.walkable].filter((tileKey) => !level.blocked.has(tileKey)).length;
  const queue = [startKey];
  const visited = new Set<string>(queue);

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const neighbor of neighbors(fromKey(queue[cursor]))) {
      const neighborKey = key(neighbor);
      if (!level.walkable.has(neighborKey) || level.blocked.has(neighborKey) || visited.has(neighborKey)) continue;
      visited.add(neighborKey);
      queue.push(neighborKey);
    }
  }

  return visited.size === openCount;
}

function findCornerTouch(level: LevelData): { a: TileCoord; b: TileCoord } | undefined {
  for (const tile of [...level.walkable].map(fromKey)) {
    for (const diagonal of [
      { x: 1, y: 1 },
      { x: 1, y: -1 },
      { x: -1, y: 1 },
      { x: -1, y: -1 },
    ]) {
      const other = { x: tile.x + diagonal.x, y: tile.y + diagonal.y };
      if (!level.walkable.has(key(other))) continue;

      const firstBridge = { x: tile.x + diagonal.x, y: tile.y };
      const secondBridge = { x: tile.x, y: tile.y + diagonal.y };
      if (!level.walkable.has(key(firstBridge)) && !level.walkable.has(key(secondBridge))) {
        return { a: tile, b: other };
      }
    }
  }

  return undefined;
}
