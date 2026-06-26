import * as THREE from "three";
import type { LeanHunterRig } from "./assets/enemies/leanHunterAsset";
import { ELITE_ENEMY_SETTINGS } from "./assets/enemies/eliteEnemy/eliteEnemyAsset";
import { LEAN_HUNTER_SETTINGS } from "./assets/enemies/leanHunterAsset";
import type { DropTable, EnemyAssetSettings, EnemyAttackDefinition } from "./assetSettings";
import type { GameScene } from "./scene";
import type { EnemyAnimation } from "./types";

export type EnemyKind = "leanHunter" | "elite";

export type EnemyViewDefinition = {
  root: THREE.Object3D;
  height: number;
  updateRig?: (animation: EnemyAnimation, dt: number) => void;
  disposeMaterials: boolean;
};

export type EnemyDefinition = {
  kind: EnemyKind;
  radius: number;
  spawnWeight: (wave: number) => number;
  health: (wave: number) => number;
  speed: (wave: number) => number;
  attack: EnemyAttackDefinition;
  dropTable: DropTable;
  createView: (world: GameScene) => EnemyViewDefinition;
};

export const ENEMY_DEFINITIONS: EnemyDefinition[] = [
  {
    kind: "leanHunter",
    radius: LEAN_HUNTER_SETTINGS.collision.radius,
    spawnWeight: (wave) => Math.max(0.74, 0.92 - wave * 0.015),
    health: (wave) => LEAN_HUNTER_SETTINGS.health + wave * 5,
    speed: (wave) => LEAN_HUNTER_SETTINGS.movement.speed + wave * LEAN_HUNTER_SETTINGS.movement.waveSpeedGrowth,
    attack: primaryEnemyAttack(LEAN_HUNTER_SETTINGS),
    dropTable: LEAN_HUNTER_SETTINGS.dropTable,
    createView: (world) => {
      const rig: LeanHunterRig = world.createLeanHunterRig();
      return {
        root: rig.root,
        height: 0,
        updateRig: (animation, dt) => rig.update({ animation }, dt),
        disposeMaterials: true,
      };
    },
  },
  {
    kind: "elite",
    radius: ELITE_ENEMY_SETTINGS.collision.radius,
    spawnWeight: (wave) => Math.min(0.08 + wave * 0.015, 0.26),
    health: (wave) => ELITE_ENEMY_SETTINGS.health + wave * 8,
    speed: (wave) => ELITE_ENEMY_SETTINGS.movement.speed + wave * ELITE_ENEMY_SETTINGS.movement.waveSpeedGrowth,
    attack: primaryEnemyAttack(ELITE_ENEMY_SETTINGS),
    dropTable: ELITE_ENEMY_SETTINGS.dropTable,
    createView: (world) => {
      const rig: LeanHunterRig = world.createEliteEnemyAsset();
      return {
        root: rig.root,
        height: 0,
        updateRig: (animation, dt) => rig.update({ animation }, dt),
        disposeMaterials: true,
      };
    },
  },
];

export function chooseEnemyDefinition(wave: number, rng: () => number = Math.random): EnemyDefinition {
  const totalWeight = ENEMY_DEFINITIONS.reduce((sum, definition) => sum + definition.spawnWeight(wave), 0);
  let roll = rng() * totalWeight;

  for (const definition of ENEMY_DEFINITIONS) {
    roll -= definition.spawnWeight(wave);
    if (roll <= 0) return definition;
  }

  return ENEMY_DEFINITIONS[0];
}

function primaryEnemyAttack(settings: EnemyAssetSettings): EnemyAttackDefinition {
  const melee = settings.attacks.find((attack) => attack.kind === "melee");
  return melee ?? settings.attacks[0];
}
