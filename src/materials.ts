import * as THREE from "three";
import type { LevelRenderMaterials } from "./levelRenderer";

export type GameplayMaterials = {
  enemy: THREE.MeshStandardMaterial;
  projectile: THREE.MeshBasicMaterial;
  nova: THREE.MeshBasicMaterial;
  gate: THREE.MeshStandardMaterial;
};

export type SceneMaterials = {
  level: LevelRenderMaterials;
  gameplay: GameplayMaterials;
};

export function createSceneMaterials(loader: THREE.TextureLoader, anisotropy: number): SceneMaterials {
  const floorTexture = loader.load("/assets/facility-floor.png");
  floorTexture.colorSpace = THREE.SRGBColorSpace;
  floorTexture.wrapS = THREE.RepeatWrapping;
  floorTexture.wrapT = THREE.RepeatWrapping;
  floorTexture.repeat.set(1, 1);
  floorTexture.anisotropy = anisotropy;

  return {
    level: {
      floor: new THREE.MeshStandardMaterial({
        map: floorTexture,
        roughness: 0.78,
        metalness: 0.42,
      }),
      edge: new THREE.MeshStandardMaterial({ color: 0x111b1e, roughness: 0.86, metalness: 0.32 }),
      void: new THREE.MeshBasicMaterial({ color: 0x010304 }),
      rim: new THREE.MeshBasicMaterial({ color: 0x2ddbd2, transparent: true, opacity: 0.36 }),
    },
    gameplay: {
      enemy: new THREE.MeshStandardMaterial({
        color: 0x8cff55,
        emissive: 0x143b08,
        roughness: 0.48,
        metalness: 0.25,
      }),
      projectile: new THREE.MeshBasicMaterial({ color: 0x9bf0df }),
      nova: new THREE.MeshBasicMaterial({
        color: 0x67ddff,
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
      }),
      gate: new THREE.MeshStandardMaterial({
        color: 0x9bf0df,
        emissive: 0x0f5f58,
        roughness: 0.2,
        metalness: 0.55,
      }),
    },
  };
}
