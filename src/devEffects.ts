import * as THREE from "three";
import "./devStyle.css";
import { ENEMY_BALANCE } from "./balance";
import { PLAYER_SPEED, RETICLE_FLOOR_OFFSET, TILE_SIZE } from "./constants";
import { disposeObject3D } from "./entityLifecycle";
import { DEFAULT_FLOOR_VARIANT_ID } from "./floorVariants";
import { createThreeGameplayView, preloadGameplayEffectAssets } from "./gameView";
import { CAMERA_VIEW_OFFSETS } from "./gameCamera";
import { loadGltfAssetLibrary } from "./gltfAssetFactory";
import { InputState } from "./inputState";
import { key, tileToWorld, type LevelData, type TileCoord } from "./level";
import { movementInputFor } from "./movement";
import { createGameScene, type GameScene } from "./scene";

declare global {
  interface Window {
    __daemonEffects?: {
      placeDeathEffect: (position: { x: number; z: number }) => void;
      killTestEnemy: (position: { x: number; z: number }) => void;
      clear: () => void;
      snapshotEffects: () => ReturnType<ReturnType<typeof createThreeGameplayView>["snapshotEffects"]>;
    };
  }
}

type TestCorpse = {
  root: THREE.Object3D;
  update: (dt: number) => void;
  life: number;
};

const CAMERA_OFFSET = CAMERA_VIEW_OFFSETS.depth.clone();
const PLAYER_MODEL_FORWARD_OFFSET = Math.PI;
const TEST_LEVEL_SIZE = 45;

export async function startDevEffects(app: HTMLDivElement): Promise<void> {
  app.innerHTML = `<div class="dev-map-hud dev-effects-hud" aria-label="Effect test controls"></div>`;
  const hud = app.querySelector<HTMLDivElement>(".dev-effects-hud")!;
  const gltfAssets = await loadGltfAssetLibrary();
  const world = await createGameScene(app, gltfAssets);
  const effectAssets = await preloadGameplayEffectAssets(world.renderer, world.renderer.capabilities.getMaxAnisotropy());
  const view = createThreeGameplayView(world, effectAssets);
  const input = new InputState();
  const clock = new THREE.Clock();
  const level = createEffectTestLevel();
  const playerPosition = tileToWorld(level.start);
  const movement = new THREE.Vector3();
  const corpses: TestCorpse[] = [];
  let playerYaw = 0;
  let disposed = false;

  document.title = "Effect Test | Daemon Syndicate";
  view.renderLevel(level, { includeExitPortal: false });
  world.player.position.copy(playerPosition);
  world.reticle.position.copy(playerPosition).add(new THREE.Vector3(0, RETICLE_FLOOR_OFFSET, -TILE_SIZE));
  updateCamera(world, playerPosition);
  world.updatePlayerLocalAmbient(playerPosition);
  world.updateGameplayLighting(playerPosition, 0);
  world.updateWallOcclusion(playerPosition, world.camera, 0, true);
  await view.warmUp();
  hud.innerHTML = renderHud();

  const updatePointerWorld = (event: PointerEvent): void => {
    input.updatePointerFromEvent(event, world.camera, world.floor, world.reticle);
  };
  const placeEffect = (): void => {
    view.spawnEnemyDeath(input.pointerWorld.clone());
  };
  const placeEffectAt = (position: { x: number; z: number }): void => {
    view.spawnEnemyDeath(new THREE.Vector3(position.x, 0, position.z));
  };
  const killTestEnemy = (): void => {
    corpses.push(createTestCorpse(world, input.pointerWorld.clone(), placeEffectAt));
  };
  const killTestEnemyAt = (position: { x: number; z: number }): void => {
    corpses.push(createTestCorpse(world, new THREE.Vector3(position.x, 0, position.z), placeEffectAt));
  };
  const clear = (): void => {
    view.clearEffects();
    clearCorpses(world, corpses);
  };
  window.__daemonEffects = {
    placeDeathEffect: placeEffectAt,
    killTestEnemy: killTestEnemyAt,
    clear,
    snapshotEffects: view.snapshotEffects,
  };
  const handlePointerDown = (event: PointerEvent): void => {
    updatePointerWorld(event);
    placeEffect();
  };
  const handleKeyDown = (event: KeyboardEvent): void => {
    input.addKey(event.code);
    if (event.code === "KeyK" && !event.repeat) {
      killTestEnemy();
    }
    if (event.code === "KeyC" && !event.repeat) {
      clear();
    }
  };
  const handleKeyUp = (event: KeyboardEvent): void => {
    input.deleteKey(event.code);
  };
  const handleResize = (): void => {
    world.resize();
  };

  window.addEventListener("pointermove", updatePointerWorld);
  window.addEventListener("pointerdown", handlePointerDown);
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  window.addEventListener("resize", handleResize);

  const minWorld = tileToWorld({ x: 6, y: 6 });
  const maxWorld = tileToWorld({ x: TEST_LEVEL_SIZE - 7, y: TEST_LEVEL_SIZE - 7 });

  const animate = (): void => {
    if (disposed) return;
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.033);
    const strafe = (input.hasKey("KeyD") ? 1 : 0) - (input.hasKey("KeyA") ? 1 : 0);
    const forward = (input.hasKey("KeyW") ? 1 : 0) - (input.hasKey("KeyS") ? 1 : 0);
    movement.copy(
      movementInputFor({
        camera: world.camera,
        strafe,
        forward,
      }),
    );

    const moving = movement.lengthSq() > 0;
    if (moving) {
      movement.normalize();
      playerPosition.addScaledVector(movement, PLAYER_SPEED * dt);
      playerPosition.x = THREE.MathUtils.clamp(playerPosition.x, minWorld.x, maxWorld.x);
      playerPosition.z = THREE.MathUtils.clamp(playerPosition.z, minWorld.z, maxWorld.z);
    }

    input.updatePointerWorldFromCamera(world.camera, world.floor, world.reticle);
    const aim = input.pointerWorld.clone().sub(playerPosition).setY(0);
    if (aim.lengthSq() > 0.01) {
      playerYaw = Math.atan2(aim.x, aim.z) + PLAYER_MODEL_FORWARD_OFFSET;
    }

    world.player.position.copy(playerPosition);
    world.player.rotation.y = playerYaw;
    world.playerRig.update({ moving, moveSpeed: PLAYER_SPEED, damaged: false, lowHealth: false }, dt);
    updateCorpses(world, corpses, dt);
    view.updateEffects(dt);
    updateCamera(world, playerPosition);
    world.updatePlayerLocalAmbient(playerPosition);
    world.updateGameplayLighting(playerPosition, dt);
    world.updateWallOcclusion(playerPosition, world.camera, dt);
    world.render();
  };

  animate();

  window.addEventListener("beforeunload", () => {
    disposed = true;
    window.removeEventListener("pointermove", updatePointerWorld);
    window.removeEventListener("pointerdown", handlePointerDown);
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
    window.removeEventListener("resize", handleResize);
    clear();
    delete window.__daemonEffects;
  });
}

function createEffectTestLevel(): LevelData {
  const walkable = new Set<string>();
  for (let y = 7; y <= 37; y += 1) {
    for (let x = 7; x <= 37; x += 1) {
      if (isEffectTestVoid({ x, y })) continue;
      walkable.add(key({ x, y }));
    }
  }

  return {
    mapDepth: 0,
    width: TEST_LEVEL_SIZE,
    height: TEST_LEVEL_SIZE,
    exitDirection: "north",
    start: { x: 22, y: 20 },
    end: { x: 36, y: 36 },
    walkable,
    floorVariants: new Map([...walkable].map((tileKey) => [tileKey, DEFAULT_FLOOR_VARIANT_ID])),
    blocked: new Set(),
    environmentalObjects: [],
    spawnPoints: [],
  };
}

function isEffectTestVoid(tile: TileCoord): boolean {
  if (tile.x >= 16 && tile.x <= 19 && tile.y >= 18 && tile.y <= 22) return true;
  if (tile.x >= 7 && tile.x <= 14 && tile.y >= 24 && tile.y <= 36) return true;
  if (tile.x >= 25 && tile.x <= 33 && tile.y >= 7 && tile.y <= 13) return true;
  if (tile.x >= 30 && tile.x <= 37 && tile.y >= 25 && tile.y <= 31) return true;
  if (tile.x >= 16 && tile.x <= 24 && tile.y >= 30 && tile.y - tile.x >= 11) return true;
  return false;
}

function createTestCorpse(
  world: GameScene,
  position: THREE.Vector3,
  emitDeathEffect: (position: { x: number; z: number }) => void,
): TestCorpse {
  const asset = world.createEnemyAsset("leanHunter");
  asset.root.position.set(position.x, 0, position.z);
  asset.root.rotation.y = Math.PI;
  asset.root.visible = true;
  world.scene.add(asset.root);
  emitDeathEffect(position);
  return {
    root: asset.root,
    update: (dt) => asset.update({ animation: "death" }, dt),
    life: ENEMY_BALANCE.deathDuration + 0.24,
  };
}

function updateCorpses(world: GameScene, corpses: TestCorpse[], dt: number): void {
  for (let i = corpses.length - 1; i >= 0; i -= 1) {
    const corpse = corpses[i];
    corpse.life -= dt;
    corpse.update(dt);
    if (corpse.life <= 0) {
      world.scene.remove(corpse.root);
      disposeObject3D(corpse.root, true);
      corpses.splice(i, 1);
    }
  }
}

function clearCorpses(world: GameScene, corpses: TestCorpse[]): void {
  for (const corpse of corpses.splice(0)) {
    world.scene.remove(corpse.root);
    disposeObject3D(corpse.root, true);
  }
}

function updateCamera(world: GameScene, playerPosition: THREE.Vector3): void {
  world.camera.position.copy(playerPosition).add(CAMERA_OFFSET);
  world.camera.lookAt(playerPosition);
}

function renderHud(): string {
  return `
    <strong>Effect Test</strong>
    <span>Click: place death splatter</span>
    <span>K: kill test hunter at cursor</span>
    <span>C: clear effects</span>
    <em>Use edge cutouts to verify decals clip to floor.</em>
  `;
}
