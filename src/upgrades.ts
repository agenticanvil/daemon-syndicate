import { PLAYER_BALANCE, WEAPON_BALANCE } from "./balance";
import { PLAYER_MAX } from "./constants";
import type { PlayerResources } from "./types";

export type UpgradeId =
  | "maxHealth"
  | "maxAmmo"
  | "maxEnergy"
  | "movementSpeed"
  | "primaryDamage"
  | "novaCooldown"
  | "dash"
  | "boltPierce"
  | "novaCapacitor"
  | "emergencyShield"
  | "ammoConverter";

export type UpgradeRanks = Record<UpgradeId, number>;

export type UpgradeDefinition = {
  id: UpgradeId;
  label: string;
  description: string;
  maxRanks: number;
  unlockLevel?: number;
  prerequisites?: Partial<Record<UpgradeId, number>>;
};

export type UpgradeOption = UpgradeDefinition & {
  rank: number;
};

export type PlayerDerivedStats = {
  maxResources: PlayerResources;
  movementSpeed: number;
  primaryDamage: number;
  novaCooldown: number;
  dashUnlocked: boolean;
  dashCooldown: number;
  dashEnergyCost: number;
  dashDistance: number;
  projectilePierce: number;
  novaDamage: number;
  novaRadius: number;
  emergencyShieldUnlocked: boolean;
  ammoRefundChance: number;
};

export const UPGRADE_DEFINITIONS: Record<UpgradeId, UpgradeDefinition> = {
  maxHealth: {
    id: "maxHealth",
    label: "Max Health",
    description: "+20 health capacity",
    maxRanks: 5,
  },
  maxAmmo: {
    id: "maxAmmo",
    label: "Max Ammo",
    description: "+15 ammo capacity",
    maxRanks: 5,
  },
  maxEnergy: {
    id: "maxEnergy",
    label: "Max Energy",
    description: "+20 energy capacity",
    maxRanks: 5,
  },
  movementSpeed: {
    id: "movementSpeed",
    label: "Move Speed",
    description: "+0.35 movement speed",
    maxRanks: 5,
  },
  primaryDamage: {
    id: "primaryDamage",
    label: "Bolt Damage",
    description: "+5 bolt damage",
    maxRanks: 6,
  },
  novaCooldown: {
    id: "novaCooldown",
    label: "Nova Cooldown",
    description: "-0.18s nova cooldown",
    maxRanks: 5,
  },
  dash: {
    id: "dash",
    label: "Dash",
    description: "Unlock a short energy dash",
    maxRanks: 1,
    unlockLevel: 3,
  },
  boltPierce: {
    id: "boltPierce",
    label: "Bolt Pierce",
    description: "Bolts hit one extra target",
    maxRanks: 1,
    unlockLevel: 4,
    prerequisites: { primaryDamage: 1 },
  },
  novaCapacitor: {
    id: "novaCapacitor",
    label: "Nova Capacitor",
    description: "+8 nova damage, +0.6 radius",
    maxRanks: 3,
    unlockLevel: 4,
  },
  emergencyShield: {
    id: "emergencyShield",
    label: "Emergency Shield",
    description: "Low health triggers a shield once",
    maxRanks: 1,
    unlockLevel: 5,
    prerequisites: { maxHealth: 1 },
  },
  ammoConverter: {
    id: "ammoConverter",
    label: "Ammo Converter",
    description: "Kills can refund ammo",
    maxRanks: 3,
    unlockLevel: 5,
    prerequisites: { maxAmmo: 1 },
  },
};

export const AUTO_UPGRADE_PRIORITY: UpgradeId[] = [
  "primaryDamage",
  "dash",
  "boltPierce",
  "novaCapacitor",
  "maxAmmo",
  "movementSpeed",
  "maxHealth",
  "maxEnergy",
  "novaCooldown",
  "emergencyShield",
  "ammoConverter",
];

export function createUpgradeRanks(): UpgradeRanks {
  return {
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
  };
}

export function availableUpgradeOptions(ranks: UpgradeRanks, playerLevel: number): UpgradeOption[] {
  return Object.values(UPGRADE_DEFINITIONS)
    .filter((definition) => canUpgrade(definition, ranks, playerLevel))
    .map((definition) => ({
      ...definition,
      rank: ranks[definition.id],
    }));
}

export function derivePlayerStats(ranks: UpgradeRanks): PlayerDerivedStats {
  return {
    maxResources: {
      health: PLAYER_MAX.health + ranks.maxHealth * 20,
      ammo: PLAYER_MAX.ammo + ranks.maxAmmo * 15,
      energy: PLAYER_MAX.energy + ranks.maxEnergy * 20,
    },
    movementSpeed: PLAYER_BALANCE.speed + ranks.movementSpeed * 0.35,
    primaryDamage: WEAPON_BALANCE.primary.damage + ranks.primaryDamage * 5,
    novaCooldown: Math.max(0.8, WEAPON_BALANCE.nova.cooldown - ranks.novaCooldown * 0.18),
    dashUnlocked: ranks.dash > 0,
    dashCooldown: 1.4,
    dashEnergyCost: 18,
    dashDistance: 4.2,
    projectilePierce: ranks.boltPierce,
    novaDamage: WEAPON_BALANCE.nova.damage + ranks.novaCapacitor * 8,
    novaRadius: WEAPON_BALANCE.nova.radius + ranks.novaCapacitor * 0.6,
    emergencyShieldUnlocked: ranks.emergencyShield > 0,
    ammoRefundChance: ranks.ammoConverter * 0.08,
  };
}

function canUpgrade(definition: UpgradeDefinition, ranks: UpgradeRanks, playerLevel: number): boolean {
  if (ranks[definition.id] >= definition.maxRanks) return false;
  if (definition.unlockLevel !== undefined && playerLevel < definition.unlockLevel) return false;

  for (const [id, requiredRank] of Object.entries(definition.prerequisites ?? {}) as Array<[UpgradeId, number]>) {
    if (ranks[id] < requiredRank) return false;
  }

  return true;
}
