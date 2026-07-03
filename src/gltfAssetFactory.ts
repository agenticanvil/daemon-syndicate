import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { AssetSidecar } from "./assetManifest";
import type { EnemyAsset, EnemyAssetAnimation, EnemyKind } from "./enemyContent";
import type { EnvironmentAssetKind } from "./assetFactory";
import { applyBundledMaterialConventions, applyBundledShaderMaterials } from "./bundledShaderMaterials";
import type { PlayerRig } from "./playerAsset";
import type { ResourceKind } from "./resourceTypes";

type RuntimeGltfAsset = {
  sidecar: AssetSidecar;
  template: THREE.Group;
  animations: THREE.AnimationClip[];
};

export type GltfAssetLibrary = {
  createPlayerRig: () => PlayerRig | null;
  createEnemyAsset: (kind: EnemyKind) => EnemyAsset | null;
  createPickupAsset: (kind: ResourceKind) => { root: THREE.Object3D } | null;
  createEnvironmentAsset: (kind: EnvironmentAssetKind) => { root: THREE.Object3D } | null;
  createExitPortalAsset: () => { root: THREE.Object3D } | null;
};

const RUNTIME_GLB_ASSETS = [
  { category: "player", name: "player" },
  { category: "enemies", name: "lean-hunter" },
  { category: "enemies", name: "venom-spitter" },
  { category: "enemies", name: "elite-enemy" },
  { category: "enemies", name: "brute" },
  { category: "environment", name: "industrial-crate" },
  { category: "environment", name: "bio-vat" },
  { category: "environment", name: "exit-portal" },
  { category: "pickups", name: "health-pickup" },
  { category: "pickups", name: "ammo-pickup" },
  { category: "pickups", name: "energy-pickup" },
] as const;

export type RuntimeGltfAssetDescriptor = (typeof RUNTIME_GLB_ASSETS)[number] & {
  sidecarUrl: string;
  modelUrl: string;
};

const PICKUP_ASSET_NAME_BY_KIND = {
  health: "health-pickup",
  ammo: "ammo-pickup",
  energy: "energy-pickup",
} as const satisfies Record<ResourceKind, string>;

const ENEMY_ASSET_NAME_BY_KIND = {
  leanHunter: "lean-hunter",
  venomSpitter: "venom-spitter",
  elite: "elite-enemy",
  brute: "brute",
} as const satisfies Record<EnemyKind, string>;

export function runtimeGltfAssetDescriptors(): RuntimeGltfAssetDescriptor[] {
  return RUNTIME_GLB_ASSETS.map((asset) => ({
    ...asset,
    sidecarUrl: `/assets/${asset.category}/${asset.name}/${asset.name}.asset.json`,
    modelUrl: `/assets/${asset.category}/${asset.name}/${asset.name}.glb`,
  }));
}

export async function loadGltfAssetLibrary(): Promise<GltfAssetLibrary> {
  const loader = new GLTFLoader();
  let playerAsset: RuntimeGltfAsset | null = null;
  const enemyAssets = new Map<string, RuntimeGltfAsset>();
  const environmentAssets = new Map<string, RuntimeGltfAsset>();
  const pickupAssets = new Map<string, RuntimeGltfAsset>();

  await Promise.all(
    RUNTIME_GLB_ASSETS.map(async (asset) => {
      const sidecarUrl = runtimeAssetSidecarUrl(asset);
      const sidecarResponse = await fetch(sidecarUrl);
      if (!sidecarResponse.ok) throw new Error(`Missing runtime asset sidecar: ${sidecarUrl}`);
      const sidecar = (await sidecarResponse.json()) as AssetSidecar;
      const modelUrl = runtimeAssetModelUrl(asset, sidecar.model.file);
      const gltf = await loadGltf(loader, modelUrl);
      await applyBundledShaderMaterials(gltf.scene, sidecar, runtimeAssetBaseUrl(asset));
      applyModelConventions(gltf.scene, sidecar);
      const runtimeAsset = {
        sidecar,
        template: gltf.scene,
        animations: gltf.animations,
      };
      if (asset.category === "player") {
        playerAsset = runtimeAsset;
      } else {
        const target =
          asset.category === "enemies" ? enemyAssets : asset.category === "pickups" ? pickupAssets : environmentAssets;
        target.set(asset.name, runtimeAsset);
      }
    }),
  );

  return {
    createPlayerRig() {
      if (!playerAsset) return null;
      return createGltfPlayerRig(playerAsset);
    },
    createEnemyAsset(kind) {
      const asset = enemyAssets.get(ENEMY_ASSET_NAME_BY_KIND[kind]);
      if (!asset) return null;
      return createGltfEnemyAsset(asset);
    },
    createPickupAsset(kind) {
      const asset = pickupAssets.get(PICKUP_ASSET_NAME_BY_KIND[kind]);
      if (!asset) return null;
      return {
        root: asset.template.clone(true),
      };
    },
    createEnvironmentAsset(kind) {
      const asset = environmentAssets.get(kind);
      if (!asset) return null;
      return {
        root: asset.template.clone(true),
      };
    },
    createExitPortalAsset() {
      const asset = environmentAssets.get("exit-portal");
      if (!asset) return null;
      return {
        root: asset.template.clone(true),
      };
    },
  };
}

function runtimeAssetSidecarUrl(asset: (typeof RUNTIME_GLB_ASSETS)[number]): string {
  return `/assets/${asset.category}/${asset.name}/${asset.name}.asset.json`;
}

function runtimeAssetModelUrl(asset: (typeof RUNTIME_GLB_ASSETS)[number], file: string): string {
  return `/assets/${asset.category}/${asset.name}/${file}`;
}

function runtimeAssetBaseUrl(asset: (typeof RUNTIME_GLB_ASSETS)[number]): string {
  return `/assets/${asset.category}/${asset.name}/`;
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
  applyBundledMaterialConventions(root);
}

function createGltfEnemyAsset(asset: RuntimeGltfAsset): EnemyAsset {
  const root = cloneSkeleton(asset.template) as THREE.Group;
  const mixer = new THREE.AnimationMixer(root);
  const clips = new Map(asset.animations.map((clip) => [clip.name, clip]));
  let activeAction: THREE.AnimationAction | null = null;
  let activeAnimation: EnemyAssetAnimation | null = null;

  const playAnimation = (animation: EnemyAssetAnimation): void => {
    const clip = clips.get(animation);
    if (!clip) return;
    const nextAction = mixer.clipAction(clip);
    if (activeAction === nextAction) return;
    activeAction?.fadeOut(0.08);
    nextAction.reset().fadeIn(0.08).play();
    if (animation === "death") {
      nextAction.setLoop(THREE.LoopOnce, 1);
      nextAction.clampWhenFinished = true;
    } else {
      nextAction.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
      nextAction.clampWhenFinished = false;
    }
    activeAction = nextAction;
  };

  return {
    root,
    applyBasePose: () => {
      mixer.stopAllAction();
      activeAction = null;
      activeAnimation = null;
    },
    update: (state, dt) => {
      if (activeAnimation !== state.animation) {
        activeAnimation = state.animation;
        playAnimation(state.animation);
      }
      mixer.update(dt);
    },
  };
}

function createGltfPlayerRig(asset: RuntimeGltfAsset): PlayerRig {
  const root = cloneSkeleton(asset.template) as THREE.Group;
  const mixer = new THREE.AnimationMixer(root);
  const clips = new Map(asset.animations.map((clip) => [clip.name, clip]));
  const body = findMesh(root, "body");
  const handSocket = ensureGroup(root, "weapon-socket");
  let activeAction: THREE.AnimationAction | null = null;
  let activeAnimation: string | null = null;
  let fireTimer = 0;
  let equippedWeapon = handSocket.getObjectByName("pulse-rifle") ?? null;

  const playAnimation = (animation: string): void => {
    const clip = clips.get(animation);
    if (!clip) return;
    const nextAction = mixer.clipAction(clip);
    if (activeAction === nextAction) return;
    activeAction?.fadeOut(0.08);
    nextAction.reset().fadeIn(0.08).play();
    if (animation === "fire" || animation === "damaged") {
      nextAction.setLoop(THREE.LoopOnce, 1);
      nextAction.clampWhenFinished = true;
    } else {
      nextAction.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
      nextAction.clampWhenFinished = false;
    }
    activeAction = nextAction;
  };

  return {
    root,
    body,
    handSocket,
    setWeapon(weapon: THREE.Object3D) {
      if (equippedWeapon) handSocket.remove(equippedWeapon);
      equippedWeapon = weapon;
      handSocket.add(equippedWeapon);
    },
    triggerFire() {
      fireTimer = 0.18;
    },
    applyBasePose() {
      mixer.stopAllAction();
      activeAction = null;
      activeAnimation = null;
      fireTimer = 0;
    },
    update(state, dt) {
      fireTimer = Math.max(0, fireTimer - dt);
      const animation =
        fireTimer > 0
          ? "fire"
          : state.damaged
            ? "damaged"
            : state.moving
              ? "walk"
              : "idle";
      if (activeAnimation !== animation) {
        activeAnimation = animation;
        playAnimation(animation);
      }
      mixer.update(dt * Math.max(1, state.moving ? state.moveSpeed / 5 : 1));
    },
  };
}

function findMesh(root: THREE.Object3D, name: string): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
  const object = root.getObjectByName(name) ?? root.getObjectByProperty("type", "Mesh");
  if (!(object instanceof THREE.Mesh)) throw new Error(`Missing GLB mesh: ${name}`);
  if (!(object.material instanceof THREE.MeshStandardMaterial)) {
    object.material = new THREE.MeshStandardMaterial({ color: 0x9fb4b8, roughness: 0.5, metalness: 0.55 });
  }
  return object as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
}

function ensureGroup(root: THREE.Object3D, name: string): THREE.Group {
  const object = root.getObjectByName(name);
  if (object instanceof THREE.Group) return object;
  if (object) {
    const group = new THREE.Group();
    group.name = object.name;
    group.position.copy(object.position);
    group.quaternion.copy(object.quaternion);
    group.scale.copy(object.scale);
    while (object.children.length > 0) {
      group.add(object.children[0]);
    }
    object.parent?.add(group);
    object.parent?.remove(object);
    return group;
  }
  const group = new THREE.Group();
  group.name = name;
  root.add(group);
  return group;
}
