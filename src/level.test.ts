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
      spawnPoints: first.spawnPoints,
    }).toEqual({
      exitDirection: second.exitDirection,
      start: second.start,
      end: second.end,
      walkable: [...second.walkable],
      spawnPoints: second.spawnPoints,
    });
  });
});
