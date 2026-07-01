import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AssetSidecar } from "./assetManifest";
import type { EnvironmentAssetKind } from "./assets/environment/industrialCrate/industrialCrateAsset";

type RuntimeGltfAsset = {
  sidecar: AssetSidecar;
  template: THREE.Group;
};

export type GltfAssetLibrary = {
  createEnvironmentAsset: (kind: EnvironmentAssetKind) => { root: THREE.Object3D } | null;
};

const RUNTIME_GLB_ASSETS = [{ category: "environment", name: "industrial-crate" }] as const;

export async function loadGltfAssetLibrary(): Promise<GltfAssetLibrary> {
  const loader = new GLTFLoader();
  const environmentAssets = new Map<string, RuntimeGltfAsset>();

  await Promise.all(
    RUNTIME_GLB_ASSETS.map(async (asset) => {
      const sidecarUrl = `/assets/${asset.category}/${asset.name}/${asset.name}.asset.json`;
      const sidecarResponse = await fetch(sidecarUrl);
      if (!sidecarResponse.ok) throw new Error(`Missing runtime asset sidecar: ${sidecarUrl}`);
      const sidecar = (await sidecarResponse.json()) as AssetSidecar;
      const modelUrl = `/assets/${asset.category}/${asset.name}/${sidecar.model.file}`;
      const gltf = await loadGltf(loader, modelUrl);
      applyModelConventions(gltf.scene, sidecar);
      environmentAssets.set(asset.name, {
        sidecar,
        template: gltf.scene,
      });
    }),
  );

  return {
    createEnvironmentAsset(kind) {
      const asset = environmentAssets.get(kind);
      if (!asset) return null;
      return {
        root: asset.template.clone(true),
      };
    },
  };
}

function loadGltf(loader: GLTFLoader, url: string): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

function applyModelConventions(root: THREE.Object3D, sidecar: AssetSidecar): void {
  root.scale.setScalar(sidecar.model.scale ?? 1);
  root.rotation.y = sidecar.model.rotationY ?? 0;
  root.position.y = sidecar.model.floorOffset ?? 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
}
