import type * as THREE from "three";
import type { EnemyAssetSettings } from "../../../assetSettings";
import { loadLeanHunterRig, type LeanHunterRig } from "../leanHunterAsset";
import venomSpitterSettings from "./venomSpitter.settings.json";

const VENOM_SPITTER_ATLAS_URL = "/assets/venom-spitter-atlas.png";

export const VENOM_SPITTER_SETTINGS = venomSpitterSettings as EnemyAssetSettings;

export type VenomSpitterAsset = LeanHunterRig;

export function createVenomSpitterAsset(loader: THREE.TextureLoader, anisotropy: number): VenomSpitterAsset {
  return loadLeanHunterRig(loader, anisotropy, {
    atlasUrl: VENOM_SPITTER_ATLAS_URL,
    name: "venom-spitter-rig",
    rimColor: 0x8dff38,
    rimStrength: 0.2,
  });
}
