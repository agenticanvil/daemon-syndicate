import { describe, expect, it } from "vitest";
import { PLAYER_BALANCE, WEAPON_BALANCE } from "./balance";
import { PLAYER_MAX } from "./constants";
import { availableUpgradeOptions, createUpgradeRanks, derivePlayerStats } from "./upgrades";

describe("upgrades", () => {
  it("derives player stats from upgrade ranks", () => {
    const ranks = createUpgradeRanks();
    ranks.maxHealth = 2;
    ranks.maxAmmo = 1;
    ranks.maxEnergy = 1;
    ranks.movementSpeed = 2;
    ranks.primaryDamage = 3;
    ranks.novaCooldown = 2;
    ranks.dash = 1;
    ranks.boltPierce = 1;
    ranks.novaCapacitor = 2;
    ranks.emergencyShield = 1;
    ranks.ammoConverter = 2;

    expect(derivePlayerStats(ranks)).toEqual({
      maxResources: {
        health: PLAYER_MAX.health + 40,
        ammo: PLAYER_MAX.ammo + 15,
        energy: PLAYER_MAX.energy + 20,
      },
      movementSpeed: PLAYER_BALANCE.speed + 0.7,
      primaryDamage: WEAPON_BALANCE.primary.damage + 15,
      novaCooldown: WEAPON_BALANCE.nova.cooldown - 0.36,
      dashUnlocked: true,
      dashCooldown: 1.4,
      dashEnergyCost: 18,
      dashDistance: 4.2,
      projectilePierce: 1,
      novaDamage: WEAPON_BALANCE.nova.damage + 16,
      novaRadius: WEAPON_BALANCE.nova.radius * 1.5,
      emergencyShieldUnlocked: true,
      ammoRefundChance: 0.16,
    });
  });

  it("filters maxed upgrade options", () => {
    const ranks = createUpgradeRanks();
    ranks.primaryDamage = 6;

    expect(availableUpgradeOptions(ranks, 10).map((option) => option.id)).not.toContain("primaryDamage");
  });

  it("hides locked ability options until level and prerequisites are met", () => {
    const ranks = createUpgradeRanks();

    expect(availableUpgradeOptions(ranks, 1).map((option) => option.id)).not.toContain("dash");
    expect(availableUpgradeOptions(ranks, 4).map((option) => option.id)).not.toContain("boltPierce");

    ranks.primaryDamage = 1;
    expect(availableUpgradeOptions(ranks, 4).map((option) => option.id)).toContain("boltPierce");
  });
});
