import {
  AMMO_DROP_AMOUNT,
  ENERGY_DROP_AMOUNT,
  ENERGY_REGEN_PER_SECOND,
  HEALTH_DROP_AMOUNT,
  NOVA_COOLDOWN,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PRIMARY_COOLDOWN,
  TILE_SIZE,
} from "./constants";

export const PLAYER_BALANCE = {
  radius: PLAYER_RADIUS,
  speed: PLAYER_SPEED,
  energyRegenPerSecond: ENERGY_REGEN_PER_SECOND,
  invulnerabilityDuration: 0.14,
  lowHealthThreshold: 30,
} as const;

export const WEAPON_BALANCE = {
  primary: {
    cooldown: PRIMARY_COOLDOWN,
    ammoCost: 1,
    damage: 34,
    projectileSpeed: 18,
    projectileLife: 1.05,
    projectileRadius: 0.28,
    spawnOffset: 0.8,
    spawnHeight: 0.88,
  },
  nova: {
    cooldown: NOVA_COOLDOWN,
    energyCost: 35,
    damage: 58,
    radius: 4.25,
    pushDistance: 1.2,
    lingerScalePerSecond: 1.4,
    fadePerSecond: 1.2,
  },
} as const;

export const ENEMY_BALANCE = {
  attackProximity: 0.42,
  stopProximity: 0.18,
  deathDuration: 0.5,
  attackDamage: 9,
  attackCooldown: 0.72,
  minSpawnDistance: TILE_SIZE * 5,
  pathfindingRadius: TILE_SIZE * 13,
  directApproachRadius: TILE_SIZE * 3,
  pathRefreshInterval: 0.24,
  pathRefreshJitter: 0.08,
  waypointReachedDistance: 0.35,
  maxLevelEnemyCount: 32,
} as const;

export const DROP_BALANCE = {
  pickupLife: 18,
  dropChance: 0.72,
  healthRoll: 0.14,
  ammoRoll: 0.48,
  amount: {
    health: HEALTH_DROP_AMOUNT,
    ammo: AMMO_DROP_AMOUNT,
    energy: ENERGY_DROP_AMOUNT,
  },
} as const;

export const EFFECT_BALANCE = {
  damageTextLife: 0.55,
  damageTextRisePerSecond: 1.1,
  damageTextHeight: 1.2,
  pickupBobHeight: 0.08,
  pickupBobSpeed: 0.004,
  pickupSpinSpeed: 2.6,
} as const;
