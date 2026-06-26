export const ARENA_SIZE = 38;
export const TILE_SIZE = 2.4;
export const LEVEL_WIDTH = 23;
export const LEVEL_HEIGHT = 23;
export const RETICLE_FLOOR_OFFSET = 0.08;
export const PLAYER_RADIUS = 0.55;
export const ENEMY_RADIUS = 0.48;
export const PLAYER_SPEED = 7.5;
export const PRIMARY_COOLDOWN = 0.16;
export const NOVA_COOLDOWN = 2.2;
export const AMMO_DROP_AMOUNT = 22;
export const ENERGY_DROP_AMOUNT = 32;
export const HEALTH_DROP_AMOUNT = 24;
export const ENERGY_REGEN_PER_SECOND = 8;

export const PLAYER_MAX = {
  health: 100,
  ammo: 80,
  energy: 100,
} as const;
