import { describe, expect, it } from "vitest";
import { generateLevel } from "./level";
import { seededRandom } from "./rng";

describe("generateLevel", () => {
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

  it("places a small set of non-blocking environmental crates", () => {
    for (let index = 0; index < 8; index += 1) {
      const level = generateLevel(3, seededRandom(`crate-seed-${index}`));

      expect(level.environmentalObjects.length).toBeGreaterThanOrEqual(2);
      expect(level.environmentalObjects.length).toBeLessThanOrEqual(3);
      for (const object of level.environmentalObjects) {
        const objectKey = `${object.tile.x},${object.tile.y}`;
        expect(object.kind).toBe("industrial-crate");
        expect(level.walkable.has(objectKey)).toBe(true);
        expect(level.blocked.has(objectKey)).toBe(true);
        expect(level.spawnPoints.map((spawn) => `${spawn.x},${spawn.y}`)).not.toContain(objectKey);
      }
    }
  });
});
