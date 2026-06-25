import * as THREE from "three";
import eliteEnemySettings from "./eliteEnemy.settings.json";

export const ELITE_ENEMY_SETTINGS = eliteEnemySettings;

export type EliteEnemyAsset = {
  root: THREE.Mesh<THREE.DodecahedronGeometry, THREE.MeshStandardMaterial>;
};

export function createEliteEnemyAsset(): EliteEnemyAsset {
  const root = new THREE.Mesh(new THREE.DodecahedronGeometry(0.68, 0), createEliteEnemyMaterial());
  root.position.y = 0.72;
  root.castShadow = true;
  return { root };
}

function createEliteEnemyMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xff5f5f,
    emissive: 0x3a0707,
    roughness: 0.42,
    metalness: 0.32,
  });
}
