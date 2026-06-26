import type * as THREE from "three";
import type { EnemyAssetSettings } from "../../../assetSettings";
import eliteEnemySettings from "./eliteEnemy.settings.json";
import { loadLeanHunterRig, type LeanHunterRig } from "../leanHunterAsset";

const ELITE_HUNTER_ATLAS_URL = "/assets/elite-hunter-atlas.png";

export const ELITE_ENEMY_SETTINGS = eliteEnemySettings as EnemyAssetSettings;

export type EliteEnemyAsset = LeanHunterRig;

export function createEliteEnemyAsset(loader: THREE.TextureLoader, anisotropy: number): EliteEnemyAsset {
  return loadLeanHunterRig(loader, anisotropy, {
    atlasUrl: ELITE_HUNTER_ATLAS_URL,
    name: "elite-hunter-rig",
    rimColor: 0xff3434,
    rimStrength: 0.18,
  });
}
