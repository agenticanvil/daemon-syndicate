import * as THREE from "three";
import "./devStyle.css";
import { ENEMY_CONTENT, type EnemyKind } from "./enemyContent";
import { PLAYER_SPEED, RETICLE_FLOOR_OFFSET, TILE_SIZE } from "./constants";
import { ENVIRONMENT_ASSET_KINDS, type EnvironmentAssetKind } from "./assetFactory";
import { DEFAULT_FLOOR_VARIANT_ID } from "./floorVariants";
import { loadGltfAssetLibrary } from "./gltfAssetFactory";
import { InputState } from "./inputState";
import { fromKey, key, tileToWorld, type LevelData, type TileCoord } from "./level";
import { movementInputFor } from "./movement";
import type { ResourceKind } from "./resourceTypes";
import { createGameScene, type GameScene } from "./scene";

type DevMapSectionId = "enemies" | "pickups" | "environment";

type DevMapItem = {
  section: DevMapSectionId;
  label: string;
  create: (world: GameScene) => { root: THREE.Object3D; update?: (dt: number) => void };
};

type DevMapPlacedItem = DevMapItem & {
  tile: TileCoord;
};

type DevMapSectionLayout = {
  id: DevMapSectionId;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  columns: number;
};

type DevMapLayout = {
  size: number;
  start: TileCoord;
  sections: DevMapSectionLayout[];
  items: DevMapPlacedItem[];
};

type DevMapLabel = {
  el: HTMLDivElement;
  world: THREE.Vector3;
};

const PICKUP_KINDS: ResourceKind[] = ["health", "ammo", "energy"];
const SECTION_ORDER: Array<{ id: DevMapSectionId; label: string }> = [
  { id: "enemies", label: "Enemies" },
  { id: "pickups", label: "Pickups" },
  { id: "environment", label: "Environment" },
];
const MAX_DEV_MAP_SIZE = 45;
const MIN_DEV_MAP_SIZE = 17;
const SECTION_MARGIN = 2;
const ITEM_SPACING_TILES = 3;
const CAMERA_OFFSET = new THREE.Vector3(15, 16, 15);
const PLAYER_MODEL_FORWARD_OFFSET = Math.PI;

export async function startDevMap(app: HTMLDivElement): Promise<void> {
  app.innerHTML = `<div class="dev-map-hud" aria-label="Dev map overview"></div>`;
  const hud = app.querySelector<HTMLDivElement>(".dev-map-hud")!;
  const gltfAssets = await loadGltfAssetLibrary();
  const world = await createGameScene(app, gltfAssets);
  const input = new InputState();
  const clock = new THREE.Clock();
  const items = createDevMapItems();
  const layout = createDevMapLayout(items);
  const level = createDevMapLevel(layout);
  const labels: DevMapLabel[] = [];
  const staticUpdates: Array<(dt: number) => void> = [];
  const playerPosition = tileToWorld(layout.start);
  const movement = new THREE.Vector3();
  let playerYaw = 0;
  let disposed = false;

  document.title = "Dev Map | Daemon Syndicate";
  world.renderLevel(level, { includeExitPortal: false });
  revealEntireLevel(world, level);
  world.player.position.copy(playerPosition);
  world.reticle.position.copy(playerPosition).add(new THREE.Vector3(0, RETICLE_FLOOR_OFFSET, -TILE_SIZE));

  addSectionFrames(world, layout.sections);
  labels.push(...createSectionLabels(app, layout.sections));
  for (const item of layout.items) {
    const instance = item.create(world);
    const position = tileToWorld(item.tile);
    instance.root.position.x = position.x;
    instance.root.position.z = position.z;
    instance.root.visible = true;
    world.scene.add(instance.root);
    if (instance.update) staticUpdates.push(instance.update);
    labels.push(createWorldLabel(app, item.label, position.clone().setY(2.1), "dev-map-asset-label"));
  }
  hud.innerHTML = renderHud(layout);

  const updatePointerWorld = (event: PointerEvent): void => {
    input.updatePointerFromEvent(event, world.camera, world.floor, world.reticle);
  };
  const handleKeyDown = (event: KeyboardEvent): void => {
    input.addKey(event.code);
  };
  const handleKeyUp = (event: KeyboardEvent): void => {
    input.deleteKey(event.code);
  };
  const handleResize = (): void => {
    world.resize();
  };

  window.addEventListener("pointermove", updatePointerWorld);
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  window.addEventListener("resize", handleResize);

  const minWorld = tileToWorld({ x: 0, y: 0 });
  const maxWorld = tileToWorld({ x: layout.size - 1, y: layout.size - 1 });

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
    for (const update of staticUpdates) update(dt);
    updateCamera(world, playerPosition);
    world.updatePlayerLocalAmbient(playerPosition);
    world.updateGameplayLighting(playerPosition, world.camera);
    updateLabels(labels, world.camera);
    world.render();
  };

  animate();

  window.addEventListener("beforeunload", () => {
    disposed = true;
    window.removeEventListener("pointermove", updatePointerWorld);
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
    window.removeEventListener("resize", handleResize);
  });
}

function createDevMapItems(): DevMapItem[] {
  return [
    ...ENEMY_CONTENT.map((enemy) => ({
      section: "enemies" as const,
      label: enemy.label,
      create: (world: GameScene) => {
        const asset = world.createEnemyAsset(enemy.kind as EnemyKind);
        asset.root.rotation.y = Math.PI;
        return { root: asset.root, update: (dt: number) => asset.update({ animation: "idle" }, dt) };
      },
    })),
    ...PICKUP_KINDS.map((kind) => ({
      section: "pickups" as const,
      label: pickupLabel(kind),
      create: (world: GameScene) => {
        const root = world.createPickupAsset(kind).root;
        root.position.y = 0.45;
        return {
          root,
          update: (dt: number) => {
            root.rotation.y += dt * 1.65;
          },
        };
      },
    })),
    ...ENVIRONMENT_ASSET_KINDS.map((kind) => ({
      section: "environment" as const,
      label: environmentLabel(kind),
      create: (world: GameScene) => ({ root: world.createEnvironmentAsset(kind).root }),
    })),
    {
      section: "environment",
      label: "Exit Portal",
      create: (world) => ({ root: world.createExitPortalAsset().root }),
    },
  ];
}

function createDevMapLayout(items: DevMapItem[]): DevMapLayout {
  for (let size = MIN_DEV_MAP_SIZE; size <= MAX_DEV_MAP_SIZE; size += 2) {
    const sections = createSectionsForSize(size, items);
    const lastSection = sections.at(-1);
    const totalHeight = lastSection ? lastSection.y + lastSection.height + SECTION_MARGIN : 0;
    if (totalHeight <= size - SECTION_MARGIN) {
      return placeItems({ size, start: { x: SECTION_MARGIN, y: SECTION_MARGIN }, sections, items: [] }, items);
    }
  }

  return placeItems(
    {
      size: MAX_DEV_MAP_SIZE,
      start: { x: SECTION_MARGIN, y: SECTION_MARGIN },
      sections: createSectionsForSize(MAX_DEV_MAP_SIZE, items),
      items: [],
    },
    items,
  );
}

function createSectionsForSize(size: number, items: DevMapItem[]): DevMapSectionLayout[] {
  const width = size - SECTION_MARGIN * 2;
  let y = SECTION_MARGIN + 2;
  return SECTION_ORDER.map((section) => {
    const count = Math.max(1, items.filter((item) => item.section === section.id).length);
    const columns = Math.max(1, Math.min(count, Math.floor((width - 2) / ITEM_SPACING_TILES)));
    const rows = Math.ceil(count / columns);
    const height = Math.max(5, rows * ITEM_SPACING_TILES + 2);
    const layout = { id: section.id, label: section.label, x: SECTION_MARGIN, y, width, height, columns };
    y += height + 2;
    return layout;
  });
}

function placeItems(layout: DevMapLayout, items: DevMapItem[]): DevMapLayout {
  const placedItems = items.map((item) => {
    const section = layout.sections.find((candidate) => candidate.id === item.section)!;
    const sectionItems = items.filter((candidate) => candidate.section === item.section);
    const index = sectionItems.indexOf(item);
    const col = index % section.columns;
    const row = Math.floor(index / section.columns);
    return {
      ...item,
      tile: {
        x: section.x + 2 + col * ITEM_SPACING_TILES,
        y: section.y + 2 + row * ITEM_SPACING_TILES,
      },
    };
  });

  return { ...layout, items: placedItems };
}

function createDevMapLevel(layout: DevMapLayout): LevelData {
  const walkable = new Set<string>();
  for (let y = 0; y < layout.size; y += 1) {
    for (let x = 0; x < layout.size; x += 1) {
      walkable.add(key({ x, y }));
    }
  }

  return {
    mapDepth: 0,
    width: layout.size,
    height: layout.size,
    exitDirection: "north",
    start: layout.start,
    end: { x: layout.size - 2, y: layout.size - 2 },
    walkable,
    floorVariants: new Map([...walkable].map((tileKey) => [tileKey, DEFAULT_FLOOR_VARIANT_ID])),
    blocked: new Set(),
    environmentalObjects: [],
    spawnPoints: [],
  };
}

function revealEntireLevel(world: GameScene, level: LevelData): void {
  for (const tileKey of level.walkable) {
    world.updateFog(tileToWorld(fromKey(tileKey)), 0, true);
  }
}

function addSectionFrames(world: GameScene, sections: DevMapSectionLayout[]): void {
  for (const section of sections) {
    const min = tileToWorld({ x: section.x - 0.5, y: section.y - 0.5 });
    const max = tileToWorld({ x: section.x + section.width - 0.5, y: section.y + section.height - 0.5 });
    const points = [
      new THREE.Vector3(min.x, 0.12, min.z),
      new THREE.Vector3(max.x, 0.12, min.z),
      new THREE.Vector3(max.x, 0.12, max.z),
      new THREE.Vector3(min.x, 0.12, max.z),
    ];
    const frame = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: sectionColor(section.id), transparent: true, opacity: 0.78 }),
    );
    world.scene.add(frame);
  }
}

function createSectionLabels(app: HTMLDivElement, sections: DevMapSectionLayout[]): DevMapLabel[] {
  return sections.map((section) => {
    const center = tileToWorld({ x: section.x + Math.floor(section.width / 2), y: section.y });
    return createWorldLabel(app, section.label, center.setY(2.5), `dev-map-section-label ${section.id}`);
  });
}

function createWorldLabel(app: HTMLDivElement, text: string, world: THREE.Vector3, className: string): DevMapLabel {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  app.appendChild(el);
  return { el, world };
}

function updateLabels(labels: DevMapLabel[], camera: THREE.Camera): void {
  for (const label of labels) {
    const projected = label.world.clone().project(camera);
    const visible = projected.z > -1 && projected.z < 1;
    label.el.hidden = !visible;
    if (!visible) continue;
    label.el.style.transform =
      `translate(${((projected.x + 1) * window.innerWidth) / 2}px, ${((-projected.y + 1) * window.innerHeight) / 2}px) translate(-50%, -100%)`;
  }
}

function updateCamera(world: GameScene, playerPosition: THREE.Vector3): void {
  world.camera.position.copy(playerPosition).add(CAMERA_OFFSET);
  world.camera.lookAt(playerPosition);
}

function renderHud(layout: DevMapLayout): string {
  const counts = SECTION_ORDER.map((section) => ({
    ...section,
    count: layout.items.filter((item) => item.section === section.id).length,
  }));
  return `
    <strong>Dev Map</strong>
    <span>${layout.size}x${layout.size} tiles</span>
    ${counts.map((section) => `<em>${section.label}: ${section.count}</em>`).join("")}
  `;
}

function pickupLabel(kind: ResourceKind): string {
  return `${kind[0].toUpperCase()}${kind.slice(1)} Pickup`;
}

function environmentLabel(kind: EnvironmentAssetKind): string {
  return kind
    .split("-")
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function sectionColor(section: DevMapSectionId): number {
  switch (section) {
    case "enemies":
      return 0xff5a8a;
    case "pickups":
      return 0x65d7ff;
    case "environment":
      return 0x8dff38;
  }
}
