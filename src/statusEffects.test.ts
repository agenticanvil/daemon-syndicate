import { describe, expect, it } from "vitest";
import { hasStatusEffect, setStatusEffect, tickStatusEffects, type StatusEffect } from "./statusEffects";

describe("status effects", () => {
  it("ticks down and removes expired effects", () => {
    const effects: StatusEffect[] = [
      { kind: "invulnerable", remaining: 0.2 },
      { kind: "shield", remaining: 1 },
    ];

    tickStatusEffects(effects, 0.25);

    expect(effects).toEqual([{ kind: "shield", remaining: 0.75 }]);
  });

  it("reports only active effects", () => {
    const effects: StatusEffect[] = [{ kind: "invulnerable", remaining: 0.1 }];

    expect(hasStatusEffect(effects, "invulnerable")).toBe(true);
    expect(hasStatusEffect(effects, "stun")).toBe(false);
  });

  it("refreshes matching effects", () => {
    const effects: StatusEffect[] = [{ kind: "invulnerable", remaining: 0.05 }];

    setStatusEffect(effects, { kind: "invulnerable", remaining: 0.14 });

    expect(effects).toEqual([{ kind: "invulnerable", remaining: 0.14, magnitude: undefined, sourceId: undefined }]);
  });
});
