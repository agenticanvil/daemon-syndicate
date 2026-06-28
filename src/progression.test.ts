import { describe, expect, it } from "vitest";
import { PlayerProgression, xpToNextLevel } from "./progression";

describe("PlayerProgression", () => {
  it("tracks XP thresholds and upgrade points", () => {
    const progression = new PlayerProgression();

    expect(progression.snapshot()).toEqual({
      level: 1,
      xp: 0,
      xpToNextLevel: 100,
      unspentUpgradePoints: 0,
      upgrades: {
        maxHealth: 0,
        maxAmmo: 0,
        maxEnergy: 0,
        movementSpeed: 0,
        primaryDamage: 0,
        novaCooldown: 0,
        dash: 0,
        boltPierce: 0,
        novaCapacitor: 0,
        emergencyShield: 0,
        ammoConverter: 0,
      },
    });

    expect(progression.grantXp(99)).toBe(0);
    expect(progression.snapshot()).toMatchObject({ level: 1, xp: 99, unspentUpgradePoints: 0 });

    expect(progression.grantXp(1)).toBe(1);
    expect(progression.snapshot()).toMatchObject({ level: 2, xp: 0, xpToNextLevel: 175, unspentUpgradePoints: 1 });
  });

  it("allows one grant to cross multiple levels", () => {
    const progression = new PlayerProgression();

    expect(progression.grantXp(300)).toBe(2);
    expect(progression.snapshot()).toMatchObject({ level: 3, xp: 25, xpToNextLevel: 250, unspentUpgradePoints: 2 });
  });

  it("scales level thresholds linearly", () => {
    expect(xpToNextLevel(1)).toBe(100);
    expect(xpToNextLevel(4)).toBe(325);
  });

  it("spends upgrade points into tracked ranks", () => {
    const progression = new PlayerProgression();

    expect(progression.spendUpgrade("primaryDamage")).toBe(false);
    progression.grantXp(100);

    expect(progression.spendUpgrade("primaryDamage")).toBe(true);
    expect(progression.snapshot().upgrades.primaryDamage).toBe(1);
    expect(progression.snapshot().unspentUpgradePoints).toBe(0);
  });

  it("requires unlock levels and prerequisites for ability upgrades", () => {
    const progression = new PlayerProgression();
    progression.grantXp(300);

    expect(progression.snapshot().level).toBe(3);
    expect(progression.spendUpgrade("boltPierce")).toBe(false);
    expect(progression.spendUpgrade("dash")).toBe(true);
  });
});
