import * as THREE from "three";
import { LEVEL_HEIGHT, LEVEL_WIDTH, RETICLE_FLOOR_OFFSET, TILE_SIZE } from "./constants";
import {
  createAssetFactory,
  type EnemyAsset,
  type EnvironmentAsset,
  type EnvironmentAssetKind,
  type PickupAsset,
  type PlayerRig,
  type PortalAsset,
} from "./assetFactory";
import type { EnemyKind } from "./enemyDefinitions";
import { exitGateToWorld, key, tileToWorld, worldToTile, type ExitDirection, type LevelData, type TileCoord } from "./level";
import { FogOfWar } from "./fogOfWar";
import { renderLevel as renderLevelToRoot, type LevelEdgeVisibility } from "./levelRenderer";
import { createSceneMaterials, preloadSceneTextures, type GameplayMaterials } from "./materials";
import { createPlayerLocalAmbient } from "./playerLocalAmbient";
import { createRenderContext, type GraphicsSettings } from "./renderer";
import { addGameplayLighting } from "./sceneLighting";
import type { GltfAssetLibrary } from "./gltfAssetFactory";
import type { ResourceKind } from "./resourceTypes";
import type { CameraViewMode } from "./gameCamera";

export type { CameraViewMode, GraphicsSettings };

export type GameScene = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  cameraView: CameraViewMode;
  floor: THREE.Mesh;
  player: THREE.Group;
  playerRig: PlayerRig;
  playerBody: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  reticle: THREE.Mesh;
  render: () => void;
  renderLevel: (level: LevelData, options?: RenderLevelOptions) => void;
  createEnemyAsset: (kind: EnemyKind) => EnemyAsset;
  createPickupAsset: (kind: ResourceKind) => PickupAsset;
  createEnvironmentAsset: (kind: EnvironmentAssetKind) => EnvironmentAsset;
  createExitPortalAsset: () => PortalAsset;
  updateFog: (playerPosition: THREE.Vector3, dt: number, instant?: boolean) => void;
  updateWallOcclusion: (playerPosition: THREE.Vector3, camera: THREE.Camera, dt: number, instant?: boolean) => void;
  updatePlayerLocalAmbient: (playerPosition: THREE.Vector3) => void;
  updateGameplayLighting: (playerPosition: THREE.Vector3, camera: THREE.Camera) => void;
  isTileExplored: (position: THREE.Vector3) => boolean;
  materials: GameplayMaterials;
  resize: () => void;
  applyGraphicsSettings: (settings: GraphicsSettings) => void;
};

export type RenderLevelOptions = {
  includeExitPortal?: boolean;
};

const DISPOSE_WITH_STATIC_OBJECT_KEY = "daemonSyndicateDisposeWithStaticObject";

export async function createGameScene(app: HTMLDivElement, gltfAssets?: GltfAssetLibrary): Promise<GameScene> {
  const renderContext = createRenderContext(app);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05080a);
  scene.fog = new THREE.Fog(0x05080a, 28, 72);

  const levelRoot = new THREE.Group();
  scene.add(levelRoot);

  const loader = new THREE.TextureLoader();
  const anisotropy = renderContext.renderer.capabilities.getMaxAnisotropy();
  const assetFactory = createAssetFactory(loader, anisotropy, gltfAssets);
  const preloadedFloorTextures = await preloadSceneTextures(loader, anisotropy);
  const materials = createSceneMaterials(loader, anisotropy, preloadedFloorTextures);
  const playerLocalAmbient = createPlayerLocalAmbient();
  Object.values(materials.level.floors).forEach((material) => playerLocalAmbient.applyToMaterial(material));
  playerLocalAmbient.applyToMaterial(materials.level.edge);
  playerLocalAmbient.applyToMaterial(materials.level.wall);
  playerLocalAmbient.applyToMaterial(materials.level.wallUpper);
  playerLocalAmbient.applyToMaterial(materials.gameplay.enemy);
  playerLocalAmbient.applyToMaterial(materials.gameplay.gate);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(LEVEL_WIDTH * TILE_SIZE * 1.4, LEVEL_HEIGHT * TILE_SIZE * 1.4, 1, 1),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const playerRig = assetFactory.createPlayerRig();
  const player = playerRig.root;
  const playerBody = playerRig.body;
  scene.add(player);

  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.52, 36),
    new THREE.MeshBasicMaterial({ color: 0x91fff0, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  reticle.rotation.x = -Math.PI / 2;
  reticle.position.y = RETICLE_FLOOR_OFFSET;
  reticle.renderOrder = 5;
  scene.add(reticle);

  const gameplayLighting = addGameplayLighting(scene, player);

  let fogOfWar: FogOfWar | undefined;
  let levelEdgeVisibility: LevelEdgeVisibility | undefined;
  let exploredTileKeys = new Set<string>();
  let staticVisibilityObjects: Array<{ root: THREE.Object3D; tile: TileCoord }> = [];

  const updateStaticObjectVisibility = (): void => {
    for (const object of staticVisibilityObjects) {
      object.root.visible = exploredTileKeys.has(key(object.tile));
    }
  };

  const createEnemyAsset = (kind: EnemyKind): EnemyAsset => {
    const asset = assetFactory.createEnemyAsset(kind);
    playerLocalAmbient.applyToObject(asset.root);
    return asset;
  };
  const createPickupAsset = (kind: ResourceKind): PickupAsset => {
    const asset = assetFactory.createPickupAsset(kind);
    playerLocalAmbient.applyToObject(asset.root);
    return asset;
  };
  const createEnvironmentAsset = (kind: EnvironmentAssetKind): EnvironmentAsset => {
    const asset = assetFactory.createEnvironmentAsset(kind);
    if (kind === "industrial-crate") {
      applyObjectReadabilityLift(asset.root, {
        color: 0x8fc7c6,
        emissiveMix: 0.04,
        intensity: 0.018,
        baseColorLift: 0,
      });
    }
    playerLocalAmbient.applyToObject(asset.root);
    return asset;
  };
  const createExitPortalAsset = (): PortalAsset => {
    const asset = assetFactory.createExitPortalAsset();
    playerLocalAmbient.applyToObject(asset.root);
    return asset;
  };

  const renderLevel = (level: LevelData, options: RenderLevelOptions = {}): void => {
    const includeExitPortal = options.includeExitPortal ?? true;
    fogOfWar?.dispose();
    disposeStaticObjectMaterials(staticVisibilityObjects);
    exploredTileKeys = new Set();
    staticVisibilityObjects = [];
    levelEdgeVisibility = renderLevelToRoot(levelRoot, level, materials.level);
    if (includeExitPortal) {
      const exitPortal = createExitPortalAsset();
      const exitPosition = exitGateToWorld(level.end, level.exitDirection);
      exitPortal.root.position.set(exitPosition.x, 0, exitPosition.z);
      exitPortal.root.rotation.y = exitGateRotation(level.exitDirection);
      levelRoot.add(exitPortal.root);
      staticVisibilityObjects.push({ root: exitPortal.root, tile: level.end });
    }
    for (const object of level.environmentalObjects) {
      const asset = createEnvironmentAsset(object.kind);
      const position = tileToWorld(object.tile);
      asset.root.position.x = position.x;
      asset.root.position.z = position.z;
      asset.root.rotation.y = object.rotation;
      levelRoot.add(asset.root);
      staticVisibilityObjects.push({ root: asset.root, tile: object.tile });
    }
    fogOfWar = new FogOfWar(level, (exploredKeys) => {
      exploredTileKeys = new Set(exploredKeys);
      levelEdgeVisibility?.updateExploredTiles(exploredKeys);
      updateStaticObjectVisibility();
    });
  };

  const exitGateRotation = (direction: ExitDirection): number => {
    switch (direction) {
      case "east":
        return Math.PI / 2;
      case "south":
        return Math.PI;
      case "west":
        return -Math.PI / 2;
      case "north":
        return 0;
    }
  };

  return {
    get renderer() {
      return renderContext.renderer;
    },
    scene,
    get camera() {
      return renderContext.camera;
    },
    get cameraView() {
      return renderContext.cameraView;
    },
    floor,
    player,
    playerRig,
    playerBody,
    reticle,
    render: () => renderContext.render(scene, renderContext.camera),
    renderLevel,
    createEnemyAsset,
    createPickupAsset,
    createEnvironmentAsset,
    createExitPortalAsset,
    updateFog: (playerPosition, dt, instant = false) => fogOfWar?.update(playerPosition, dt, instant),
    updateWallOcclusion: (playerPosition, camera, dt, instant = false) =>
      levelEdgeVisibility?.updateWallOcclusion(playerPosition, camera, dt, instant),
    updatePlayerLocalAmbient: playerLocalAmbient.update,
    updateGameplayLighting: gameplayLighting.update,
    isTileExplored: (position) => exploredTileKeys.has(key(worldToTile(position))),
    materials: materials.gameplay,
    resize: renderContext.resize,
    applyGraphicsSettings: renderContext.applyGraphicsSettings,
  };
}

type ReadabilityLiftOptions = {
  color: THREE.ColorRepresentation;
  emissiveMix: number;
  intensity: number;
  baseColorLift: number;
};

function applyObjectReadabilityLift(root: THREE.Object3D, options: ReadabilityLiftOptions): void {
  const liftColor = new THREE.Color(options.color);
  const liftedMaterials = new Map<THREE.Material, THREE.Material>();

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const nextMaterials = materials.map((material) => {
      const lifted = liftedMaterials.get(material) ?? liftMaterial(material, liftColor, options);
      liftedMaterials.set(material, lifted);
      return lifted;
    });
    object.material = Array.isArray(object.material) ? nextMaterials : nextMaterials[0];
  });
}

function liftMaterial(
  material: THREE.Material,
  liftColor: THREE.Color,
  options: ReadabilityLiftOptions,
): THREE.Material {
  const lifted = material.clone();
  lifted.userData[DISPOSE_WITH_STATIC_OBJECT_KEY] = true;
  if (lifted instanceof THREE.MeshStandardMaterial || lifted instanceof THREE.MeshPhysicalMaterial) {
    lifted.color.lerp(new THREE.Color(0xffffff), options.baseColorLift);
    lifted.emissive.lerp(liftColor, options.emissiveMix);
    lifted.emissiveIntensity += options.intensity;
    lifted.needsUpdate = true;
  }
  return lifted;
}

function disposeStaticObjectMaterials(objects: Array<{ root: THREE.Object3D }>): void {
  const materials = new Set<THREE.Material>();
  for (const object of objects) {
    object.root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of childMaterials) {
        if (material.userData[DISPOSE_WITH_STATIC_OBJECT_KEY] === true) materials.add(material);
      }
    });
  }
  materials.forEach((material) => material.dispose());
}
