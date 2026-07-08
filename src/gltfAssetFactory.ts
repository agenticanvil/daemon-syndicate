import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { AssetSidecar } from "./assetManifest";
import type { EnemyAsset, EnemyAssetAnimation, EnemyKind } from "./enemyContent";
import type { EnvironmentAssetKind } from "./assetFactory";
import { applyBundledMaterialConventions, applyBundledShaderMaterials } from "./bundledShaderMaterials";
import type { PlayerRig, WeaponAttachmentOptions } from "./playerAsset";
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
  createEquipmentAsset: (kind: EquipmentAssetKind) => { root: THREE.Object3D } | null;
  createExitPortalAsset: () => { root: THREE.Object3D } | null;
};

const PLAYER_WEAPON_SOCKET = "socket.weapon.primary";
const WEAPON_GRIP_SOCKET = "socket.grip";
const DEFAULT_PLAYER_WEAPON = "bolt-rifle";
const WEAPON_ATTACHMENT_KEY = "daemonSyndicateEquippedWeapon";
const SOCKET_DEBUG_HELPER_PREFIX = "debug.weaponSocket.";

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
  { category: "equipment", name: "bolt-rifle" },
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

export type EquipmentAssetKind = "bolt-rifle";

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
  const equipmentAssets = new Map<string, RuntimeGltfAsset>();
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
          asset.category === "enemies"
            ? enemyAssets
            : asset.category === "pickups"
              ? pickupAssets
              : asset.category === "equipment"
                ? equipmentAssets
                : environmentAssets;
        target.set(asset.name, runtimeAsset);
      }
    }),
  );

  return {
    createPlayerRig() {
      if (!playerAsset) return null;
      return createGltfPlayerRig(playerAsset, equipmentAssets.get(DEFAULT_PLAYER_WEAPON) ?? null);
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
    createEquipmentAsset(kind) {
      const asset = equipmentAssets.get(kind);
      if (!asset) return null;
      return createGltfStaticAsset(asset);
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
  cloneMaterials(root);
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

function createGltfStaticAsset(asset: RuntimeGltfAsset): { root: THREE.Object3D } {
  const root = asset.template.clone(true);
  cloneMaterials(root);
  return { root };
}

function cloneMaterials(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.material = Array.isArray(object.material)
      ? object.material.map((material) => material.clone())
      : object.material.clone();
  });
}

function createGltfPlayerRig(asset: RuntimeGltfAsset, defaultWeaponAsset: RuntimeGltfAsset | null): PlayerRig {
  const root = cloneSkeleton(asset.template) as THREE.Group;
  cloneMaterials(root);
  const mixer = new THREE.AnimationMixer(root);
  const clips = new Map(asset.animations.map((clip) => [clip.name, clip]));
  const body = findMesh(root, "body");
  const handSocket = findSocket(root, PLAYER_WEAPON_SOCKET);
  if (!handSocket) throw new Error(`Missing player socket: ${PLAYER_WEAPON_SOCKET}`);
  let activeAction: THREE.AnimationAction | null = null;
  let activeAnimation: string | null = null;
  let equippedWeapon: THREE.Object3D | null = null;

  const playAnimation = (animation: string): void => {
    const clip = clips.get(animation);
    if (!clip) return;
    const nextAction = mixer.clipAction(clip);
    if (activeAction === nextAction) return;
    activeAction?.fadeOut(0.08);
    nextAction.reset().fadeIn(0.08).play();
    nextAction.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
    nextAction.clampWhenFinished = false;
    activeAction = nextAction;
  };

  const setWeapon = (weapon: THREE.Object3D, options: WeaponAttachmentOptions = {}): void => {
    equippedWeapon = weapon;
    attachWeaponToSocket({
      playerRoot: root,
      weaponRoot: equippedWeapon,
      debugSockets: options.debugSockets ?? weaponSocketDebugEnabled(),
    });
  };

  const rig: PlayerRig = {
    root,
    body,
    handSocket,
    setWeapon,
    triggerFire() {},
    applyBasePose() {
      mixer.stopAllAction();
      activeAction = null;
      activeAnimation = null;
    },
    update(state, dt) {
      const animation = state.moving ? "walk" : "idle";
      if (activeAnimation !== animation) {
        activeAnimation = animation;
        playAnimation(animation);
      }
      mixer.update(dt * Math.max(1, state.moving ? state.moveSpeed / 5 : 1));
    },
  };

  if (defaultWeaponAsset) setWeapon(createGltfStaticAsset(defaultWeaponAsset).root);

  return rig;
}

export function attachWeaponToSocket({
  playerRoot,
  weaponRoot,
  playerSocketName = PLAYER_WEAPON_SOCKET,
  weaponSocketName = WEAPON_GRIP_SOCKET,
  debugSockets = false,
}: {
  playerRoot: THREE.Object3D;
  weaponRoot: THREE.Object3D;
  playerSocketName?: string;
  weaponSocketName?: string;
  debugSockets?: boolean;
}): THREE.Object3D {
  const playerSocket = findSocket(playerRoot, playerSocketName);
  const weaponSocket = findSocket(weaponRoot, weaponSocketName);

  if (!playerSocket) throw new Error(`Missing player socket: ${playerSocketName}`);
  if (!weaponSocket) throw new Error(`Missing weapon socket: ${weaponSocketName}`);

  playerRoot.updateWorldMatrix(true, true);
  weaponRoot.updateWorldMatrix(true, true);
  playerSocket.updateWorldMatrix(true, false);
  weaponSocket.updateWorldMatrix(true, false);

  const socketFromWeaponRoot = weaponRoot.matrixWorld.clone().invert().multiply(weaponSocket.matrixWorld);
  const weaponRootFromSocket = socketFromWeaponRoot.clone().invert();

  removePreviousWeaponAttachments(playerSocket, weaponRoot);
  playerSocket.add(weaponRoot);
  weaponRoot.userData[WEAPON_ATTACHMENT_KEY] = true;
  weaponRoot.matrixAutoUpdate = true;
  weaponRootFromSocket.decompose(weaponRoot.position, weaponRoot.quaternion, weaponRoot.scale);
  weaponRoot.updateMatrix();
  playerSocket.updateWorldMatrix(true, false);
  weaponRoot.updateWorldMatrix(true, true);

  setSocketDebugHelper(playerSocket, "player", debugSockets);
  setSocketDebugHelper(weaponSocket, "grip", debugSockets);

  return playerSocket;
}

function removePreviousWeaponAttachments(playerSocket: THREE.Object3D, nextWeapon: THREE.Object3D): void {
  for (const child of [...playerSocket.children]) {
    if (child !== nextWeapon && child.userData[WEAPON_ATTACHMENT_KEY]) playerSocket.remove(child);
  }
}

function findSocket(root: THREE.Object3D, socketName: string): THREE.Object3D | null {
  const named = root.getObjectByName(socketName);
  if (named) return named;

  const expectedSocketId = socketName.replace(/^socket\./, "");
  let socket: THREE.Object3D | null = null;
  root.traverse((object) => {
    if (socket) return;
    const assetAnvil = object.userData.assetAnvil as { socket?: boolean; id?: string } | undefined;
    if (assetAnvil?.socket === true && assetAnvil.id === expectedSocketId) socket = object;
  });
  return socket;
}

function setSocketDebugHelper(socket: THREE.Object3D, id: string, enabled: boolean): void {
  const helperName = `${SOCKET_DEBUG_HELPER_PREFIX}${id}`;
  const existing = socket.getObjectByName(helperName);
  if (!enabled) {
    if (existing) socket.remove(existing);
    return;
  }
  if (existing) return;
  const helper = new THREE.AxesHelper(0.35);
  helper.name = helperName;
  helper.renderOrder = 1000;
  socket.add(helper);
}

function weaponSocketDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.has("debugWeaponSockets") || window.localStorage.getItem("daemonSyndicate.debugWeaponSockets") === "1";
  } catch {
    return false;
  }
}

function findMesh(root: THREE.Object3D, name: string): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> {
  const object = root.getObjectByName(name) ?? findFirstMesh(root);
  if (!(object instanceof THREE.Mesh)) throw new Error(`Missing GLB mesh: ${name}`);
  if (!(object.material instanceof THREE.MeshStandardMaterial)) {
    object.material = new THREE.MeshStandardMaterial({ color: 0x9fb4b8, roughness: 0.5, metalness: 0.55 });
  }
  return object as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
}

function findFirstMesh(root: THREE.Object3D): THREE.Mesh | null {
  let mesh: THREE.Mesh | null = null;
  root.traverse((object) => {
    if (!mesh && object instanceof THREE.Mesh) mesh = object;
  });
  return mesh;
}
