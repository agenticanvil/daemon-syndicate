import * as THREE from "three";
import type { EnvironmentAssetSettings } from "../../../assetSettings";
import industrialCrateSettings from "./industrialCrate.settings.json";

const INDUSTRIAL_CRATE_ATLAS_URL = "/assets/industrial-crate-atlas.png";

const INDUSTRIAL_CRATE_SETTINGS = industrialCrateSettings as EnvironmentAssetSettings;

export type EnvironmentAssetKind = "industrial-crate";

export type IndustrialCrateAsset = {
  root: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
};

export function createIndustrialCrateAsset(loader: THREE.TextureLoader, anisotropy: number): IndustrialCrateAsset {
  const texture = loader.load(INDUSTRIAL_CRATE_ATLAS_URL);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;

  const root = new THREE.Mesh(
    new THREE.BoxGeometry(1.18, INDUSTRIAL_CRATE_SETTINGS.collision.height, 1.08),
    new THREE.MeshStandardMaterial({
      map: texture,
      color: 0xbfc7c8,
      roughness: 0.66,
      metalness: 0.58,
      emissive: 0x120302,
      emissiveIntensity: 0.22,
    }),
  );
  root.name = "industrial-crate";
  root.position.y = INDUSTRIAL_CRATE_SETTINGS.collision.height * 0.5;
  root.castShadow = true;
  root.receiveShadow = true;
  return { root };
}
