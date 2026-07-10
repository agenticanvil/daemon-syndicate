import * as THREE from "three";
import { TILE_SIZE } from "./constants";
import {
  exitGateTiles,
  fromKey,
  key,
  neighbors,
  tileToWorld,
  worldToTile,
  type LevelData,
  type TileCoord,
} from "./level";

const CORRIDOR_LIGHT_COUNT = 3;
const CORRIDOR_LIGHT_SLOT_COUNT = CORRIDOR_LIGHT_COUNT + 1;
const CORRIDOR_LIGHT_INTENSITY = 48;
const CORRIDOR_LIGHT_ACTIVATION_SECONDS = 0.2;
const CORRIDOR_LIGHT_ACTIVATION_RADIUS = TILE_SIZE * 7.5;
const CORRIDOR_LIGHT_SENSOR_INSET = 0.3;
const LINE_OF_SIGHT_SAMPLE_DISTANCE = TILE_SIZE * 0.2;
const CORRIDOR_LIGHT_HEIGHT = 1.72;
const CORRIDOR_LIGHT_REASSIGN_DISTANCE = 0.75;
const CORRIDOR_FLICKER_MIN_DELAY = 2.5;
const CORRIDOR_FLICKER_DELAY_RANGE = 5.5;
const CORRIDOR_FLICKER_DURATION = 0.16;
const FIXTURE_MIN_SPACING_TILES = 5;
const FIXTURE_MAX_COUNT = 32;
const FIXTURE_COLORS = [0x9ddbd6, 0xc8d6c6, 0xe0b875] as const;
const OVERHEAD_POOL_CAMERA_OFFSET = 3.2;
const OVERHEAD_POOL_LEFT_OFFSET = -0.45;
const OVERHEAD_POOL_HEIGHT = 5.4;
const OVERHEAD_POOL_TO_CAMERA = new THREE.Vector3();
const OVERHEAD_POOL_LEFT = new THREE.Vector3();
const OVERHEAD_POOL_TARGET = new THREE.Vector3();
const FIXTURE_HOUSING_OFF_COLOR = new THREE.Color(0x111817);
const FIXTURE_PANEL_OFF_COLOR = new THREE.Color(0x030605);
const FIXTURE_ON_COLOR_SCRATCH = new THREE.Color();
const FIXTURE_RESULT_COLOR_SCRATCH = new THREE.Color();

type FixtureVisualBinding = {
  housing: THREE.InstancedMesh;
  panel: THREE.InstancedMesh;
  index: number;
};

type CorridorFixture = {
  position: THREE.Vector3;
  color: THREE.Color;
  colorIndex: number;
  rotationY: number;
  inward: THREE.Vector3;
  brightness: number;
  flicker: number;
  flickerDelay: number;
  flickerTime: number;
  flickerSeed: number;
  active: boolean;
  visual?: FixtureVisualBinding;
};

type CorridorLightSlot = {
  light: THREE.SpotLight;
  brightness: number;
  fixture?: CorridorFixture;
};

type WallFixtureCandidate = {
  tile: TileCoord;
  position: THREE.Vector3;
  rotationY: number;
  inward: THREE.Vector3;
  hash: number;
};

export type GameplayLighting = {
  setLevel: (level: LevelData) => void;
  update: (playerPosition: THREE.Vector3, camera: THREE.Camera, dt: number) => void;
};

export function addGameplayLighting(scene: THREE.Scene, playerLightAnchor: THREE.Group): GameplayLighting {
  const ambient = new THREE.HemisphereLight(0x75b7b9, 0x020504, 0.16);
  scene.add(ambient);

  const alertLight = new THREE.PointLight(0xff3344, 18, 18);
  alertLight.position.set(-9, 5, -9);
  scene.add(alertLight);

  const overheadPoolLight = new THREE.SpotLight(0x82aaa7, 27, 18, 1.1, 0.9, 1.4);
  overheadPoolLight.name = "player-environment-light";
  overheadPoolLight.castShadow = false;
  scene.add(overheadPoolLight, overheadPoolLight.target);

  const fixtureRoot = new THREE.Group();
  fixtureRoot.name = "corridor-light-fixtures";
  scene.add(fixtureRoot);

  const corridorLightSlots = Array.from({ length: CORRIDOR_LIGHT_SLOT_COUNT }, (_, index): CorridorLightSlot => {
    const light = new THREE.SpotLight(FIXTURE_COLORS[index % FIXTURE_COLORS.length], 0, 16, 1.15, 0.82, 1.55);
    light.castShadow = false;
    light.shadow.mapSize.set(512, 512);
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = 16;
    light.shadow.bias = -0.00008;
    light.shadow.normalBias = 0.012;
    light.target.position.y = 0.15;
    scene.add(light, light.target);
    return { light, brightness: 0 };
  });

  const armorFlashlight = new THREE.SpotLight(0xa8fff4, 72, 38, 0.74, 0.62, 1.45);
  armorFlashlight.position.set(0, 1.35, -0.28);
  armorFlashlight.target.position.set(0, 0.8, -14);
  armorFlashlight.castShadow = true;
  armorFlashlight.shadow.mapSize.set(1024, 1024);
  armorFlashlight.shadow.camera.near = 0.12;
  armorFlashlight.shadow.camera.far = 38;
  armorFlashlight.shadow.bias = -0.00005;
  armorFlashlight.shadow.normalBias = 0.001;
  playerLightAnchor.add(armorFlashlight);
  playerLightAnchor.add(armorFlashlight.target);

  let fixtures: CorridorFixture[] = [];
  let activeFixtureQueue: CorridorFixture[] = [];
  let currentLevel: LevelData | undefined;
  const lastAssignmentPosition = new THREE.Vector3(Number.POSITIVE_INFINITY, 0, 0);

  return {
    setLevel: (level) => {
      currentLevel = level;
      disposeFixtureVisuals(fixtureRoot);
      fixtures = createCorridorFixtures(level);
      activeFixtureQueue = [];
      addFixtureVisuals(fixtureRoot, fixtures);
      lastAssignmentPosition.set(Number.POSITIVE_INFINITY, 0, 0);
      corridorLightSlots.forEach((slot) => {
        slot.fixture = undefined;
        slot.brightness = 0;
        slot.light.intensity = 0;
        slot.light.castShadow = false;
      });
    },
    update: (playerPosition, camera, dt) => {
      updateOverheadPoolLight(overheadPoolLight, playerPosition, camera);
      if (playerPosition.distanceToSquared(lastAssignmentPosition) >= CORRIDOR_LIGHT_REASSIGN_DISTANCE ** 2) {
        lastAssignmentPosition.copy(playerPosition);
        if (currentLevel) {
          updateActiveFixtureQueue(activeFixtureQueue, fixtures, playerPosition, currentLevel);
          syncFixtureLightSlots(corridorLightSlots, activeFixtureQueue, playerPosition);
        }
      }
      updateFixtureActivation(corridorLightSlots, fixtures, dt);
      syncFixtureLightSlots(corridorLightSlots, activeFixtureQueue, playerPosition);
    },
  };
}

function updateOverheadPoolLight(light: THREE.SpotLight, playerPosition: THREE.Vector3, camera: THREE.Camera): void {
  camera.updateMatrixWorld();
  OVERHEAD_POOL_TARGET.copy(playerPosition).setY(playerPosition.y + 0.12);
  OVERHEAD_POOL_TO_CAMERA.copy(camera.position).sub(OVERHEAD_POOL_TARGET).setY(0);
  if (OVERHEAD_POOL_TO_CAMERA.lengthSq() < 0.0001) OVERHEAD_POOL_TO_CAMERA.set(1, 0, 1);
  OVERHEAD_POOL_TO_CAMERA.normalize();

  OVERHEAD_POOL_LEFT.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(-1).setY(0);
  if (OVERHEAD_POOL_LEFT.lengthSq() < 0.0001) OVERHEAD_POOL_LEFT.set(-1, 0, 0);
  OVERHEAD_POOL_LEFT.normalize();

  light.target.position.copy(OVERHEAD_POOL_TARGET);
  light.position
    .copy(OVERHEAD_POOL_TARGET)
    .addScaledVector(OVERHEAD_POOL_TO_CAMERA, OVERHEAD_POOL_CAMERA_OFFSET)
    .addScaledVector(OVERHEAD_POOL_LEFT, OVERHEAD_POOL_LEFT_OFFSET);
  light.position.y = playerPosition.y + OVERHEAD_POOL_HEIGHT;
}

export function createCorridorFixtures(level: LevelData): CorridorFixture[] {
  const candidates = collectWallFixtureCandidates(level);
  const selected: WallFixtureCandidate[] = [];
  const startCandidate = nearestCandidate(candidates, tileToWorld(level.start));
  if (startCandidate) selected.push(startCandidate);
  const endCandidate = nearestCandidate(candidates, tileToWorld(level.end));
  if (endCandidate && !selected.includes(endCandidate) && isSpacedFromSelected(endCandidate, selected)) {
    selected.push(endCandidate);
  }

  for (const candidate of candidates) {
    if (selected.length >= FIXTURE_MAX_COUNT) break;
    if (!isSpacedFromSelected(candidate, selected)) continue;
    selected.push(candidate);
  }

  return selected.map((candidate) => {
    const colorIndex = fixtureHash(candidate.tile, level.mapDepth + 17) % FIXTURE_COLORS.length;
    return {
      position: candidate.position,
      color: new THREE.Color(FIXTURE_COLORS[colorIndex]),
      colorIndex,
      rotationY: candidate.rotationY,
      inward: candidate.inward,
      brightness: 0,
      flicker: 1,
      flickerDelay: CORRIDOR_FLICKER_MIN_DELAY + (candidate.hash / 0xffffffff) * CORRIDOR_FLICKER_DELAY_RANGE,
      flickerTime: 0,
      flickerSeed: candidate.hash,
      active: false,
    };
  });
}

function addFixtureVisuals(root: THREE.Group, fixtures: CorridorFixture[]): void {
  if (fixtures.length === 0) return;
  const housingGeometry = new THREE.BoxGeometry(1.4, 0.34, 0.16);
  const panelGeometry = new THREE.BoxGeometry(1.08, 0.16, 0.035);
  const housingRoot = new THREE.Group();
  const panelRoot = new THREE.Group();
  housingRoot.name = "corridor-light-housings";
  panelRoot.name = "corridor-light-panels";

  FIXTURE_COLORS.forEach((_, colorIndex) => {
    const coloredFixtures = fixtures.filter((fixture) => fixture.colorIndex === colorIndex);
    if (coloredFixtures.length === 0) return;
    const housingMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
    });
    const panelMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
    });
    const housings = new THREE.InstancedMesh(housingGeometry, housingMaterial, coloredFixtures.length);
    const panels = new THREE.InstancedMesh(panelGeometry, panelMaterial, coloredFixtures.length);
    const transform = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const unitScale = new THREE.Vector3(1, 1, 1);

    coloredFixtures.forEach((fixture, index) => {
      rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, fixture.rotationY);
      transform.compose(fixture.position, rotation, unitScale);
      housings.setMatrixAt(index, transform);
      position.copy(fixture.position).addScaledVector(fixture.inward, 0.11);
      transform.compose(position, rotation, unitScale);
      panels.setMatrixAt(index, transform);
      housings.setColorAt(index, FIXTURE_HOUSING_OFF_COLOR);
      panels.setColorAt(index, FIXTURE_PANEL_OFF_COLOR);
      fixture.visual = { housing: housings, panel: panels, index };
    });
    housings.instanceMatrix.needsUpdate = true;
    panels.instanceMatrix.needsUpdate = true;
    if (housings.instanceColor) housings.instanceColor.needsUpdate = true;
    if (panels.instanceColor) panels.instanceColor.needsUpdate = true;
    housings.name = `corridor-light-housings-${colorIndex}`;
    panels.name = `corridor-light-panels-${colorIndex}`;
    housingRoot.add(housings);
    panelRoot.add(panels);
  });
  root.add(housingRoot, panelRoot);
}

function disposeFixtureVisuals(root: THREE.Group): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material.dispose());
  });
  root.clear();
}

function updateActiveFixtureQueue(
  activeQueue: CorridorFixture[],
  fixtures: CorridorFixture[],
  playerPosition: THREE.Vector3,
  level: LevelData,
): void {
  const visible = fixtures
    .map((fixture) => ({ fixture, distance: fixture.position.distanceToSquared(playerPosition) }))
    .filter(({ distance }) => distance <= CORRIDOR_LIGHT_ACTIVATION_RADIUS ** 2)
    .filter(({ fixture }) => {
      const sensorPosition = fixture.position.clone().addScaledVector(fixture.inward, CORRIDOR_LIGHT_SENSOR_INSET);
      return hasLevelLineOfSight(level, sensorPosition, playerPosition);
    })
    .sort((a, b) => a.distance - b.distance)
    .map(({ fixture }) => fixture);
  const newVisible = visible.filter((fixture) => !activeQueue.includes(fixture));
  const additions = activeQueue.length < CORRIDOR_LIGHT_COUNT
    ? newVisible.slice(0, CORRIDOR_LIGHT_COUNT - activeQueue.length)
    : newVisible.slice(0, 1);
  additions.forEach((fixture) => {
    activeQueue.push(fixture);
    if (activeQueue.length > CORRIDOR_LIGHT_COUNT) activeQueue.shift();
  });
  const activeSet = new Set(activeQueue);
  fixtures.forEach((fixture) => (fixture.active = activeSet.has(fixture)));
}

function syncFixtureLightSlots(
  slots: CorridorLightSlot[],
  activeQueue: CorridorFixture[],
  playerPosition: THREE.Vector3,
): void {
  slots.forEach((slot) => {
    if (slot.fixture && !slot.fixture.active && slot.fixture.brightness === 0 && slot.brightness === 0) {
      slot.fixture = undefined;
    }
  });
  activeQueue.forEach((fixture) => {
    if (slots.some((slot) => slot.fixture === fixture)) return;
    const slot = slots.find((candidate) => !candidate.fixture);
    if (!slot) return;
    slot.fixture = fixture;
    slot.brightness = 0;
    const { light } = slot;
    light.position.copy(fixture.position).addScaledVector(fixture.inward, 0.18);
    light.target.position.copy(fixture.position).addScaledVector(fixture.inward, TILE_SIZE * 2.2);
    light.target.position.y = 0.18;
    light.color.copy(fixture.color);
  });
  const closestFixture = activeQueue.reduce<CorridorFixture | undefined>((closest, fixture) => {
    if (!closest) return fixture;
    return fixture.position.distanceToSquared(playerPosition) < closest.position.distanceToSquared(playerPosition)
      ? fixture
      : closest;
  }, undefined);
  slots.forEach((slot) => {
    slot.light.castShadow = closestFixture !== undefined && slot.fixture === closestFixture;
  });
}

function updateFixtureActivation(slots: CorridorLightSlot[], fixtures: CorridorFixture[], dt: number): void {
  const brightnessStep = Math.max(dt, 0) / CORRIDOR_LIGHT_ACTIVATION_SECONDS;
  fixtures.forEach((fixture) => {
    const previousBrightness = fixture.brightness;
    const previousFlicker = fixture.flicker;
    fixture.brightness = moveTowards(fixture.brightness, fixture.active ? 1 : 0, brightnessStep);
    updateFixtureFlicker(fixture, dt);
    if (fixture.brightness !== previousBrightness || fixture.flicker !== previousFlicker) updateFixtureVisual(fixture);
  });
  slots.forEach((slot) => {
    const targetBrightness = slot.fixture?.brightness ?? 0;
    slot.brightness = moveTowards(slot.brightness, targetBrightness, brightnessStep);
    slot.light.intensity = CORRIDOR_LIGHT_INTENSITY * slot.brightness * (slot.fixture?.flicker ?? 1);
  });
}

function updateFixtureFlicker(fixture: CorridorFixture, dt: number): void {
  if (!fixture.active || fixture.brightness < 1) {
    fixture.flicker = 1;
    return;
  }
  if (fixture.flickerTime > 0) {
    fixture.flickerTime = Math.max(0, fixture.flickerTime - Math.max(dt, 0));
    const pulse = fixture.flickerTime / CORRIDOR_FLICKER_DURATION;
    fixture.flicker = 0.58 + Math.abs(Math.sin(pulse * Math.PI * 3)) * 0.42;
    if (fixture.flickerTime === 0) fixture.flicker = 1;
    return;
  }
  fixture.flickerDelay -= Math.max(dt, 0);
  if (fixture.flickerDelay > 0) return;
  fixture.flickerTime = CORRIDOR_FLICKER_DURATION;
  fixture.flickerSeed = (Math.imul(fixture.flickerSeed, 1664525) + 1013904223) >>> 0;
  fixture.flickerDelay =
    CORRIDOR_FLICKER_MIN_DELAY + (fixture.flickerSeed / 0xffffffff) * CORRIDOR_FLICKER_DELAY_RANGE;
}

function updateFixtureVisual(fixture: CorridorFixture): void {
  const visual = fixture.visual;
  if (!visual) return;
  const visibleBrightness = fixture.brightness * fixture.flicker;
  const housingOnColor = FIXTURE_ON_COLOR_SCRATCH.copy(fixture.color).multiplyScalar(0.42);
  visual.housing.setColorAt(
    visual.index,
    FIXTURE_RESULT_COLOR_SCRATCH.copy(FIXTURE_HOUSING_OFF_COLOR).lerp(housingOnColor, visibleBrightness),
  );
  const panelOnColor = FIXTURE_ON_COLOR_SCRATCH.copy(fixture.color).multiplyScalar(1.65);
  visual.panel.setColorAt(
    visual.index,
    FIXTURE_RESULT_COLOR_SCRATCH.copy(FIXTURE_PANEL_OFF_COLOR).lerp(panelOnColor, visibleBrightness),
  );
  if (visual.housing.instanceColor) visual.housing.instanceColor.needsUpdate = true;
  if (visual.panel.instanceColor) visual.panel.instanceColor.needsUpdate = true;
}

function moveTowards(value: number, target: number, maximumDelta: number): number {
  if (Math.abs(target - value) <= maximumDelta) return target;
  return value + Math.sign(target - value) * maximumDelta;
}

export function hasLevelLineOfSight(
  level: LevelData,
  fromPosition: THREE.Vector3,
  toPosition: THREE.Vector3,
): boolean {
  const distance = fromPosition.distanceTo(toPosition);
  const sampleCount = Math.max(1, Math.ceil(distance / LINE_OF_SIGHT_SAMPLE_DISTANCE));
  const sample = new THREE.Vector3();
  for (let index = 0; index <= sampleCount; index += 1) {
    sample.lerpVectors(fromPosition, toPosition, index / sampleCount);
    if (!level.walkable.has(key(worldToTile(sample)))) return false;
  }
  return true;
}

function collectWallFixtureCandidates(level: LevelData): WallFixtureCandidate[] {
  const candidates: WallFixtureCandidate[] = [];
  const exitTiles = new Set(exitGateTiles(level.end, level.exitDirection).map(key));
  const exitDirection = directionVector(level.exitDirection);

  for (const tileKey of level.walkable) {
    const tile = fromKey(tileKey);
    const center = tileToWorld(tile);
    for (const neighbor of neighbors(tile)) {
      if (level.walkable.has(key(neighbor))) continue;
      const outwardX = neighbor.x - tile.x;
      const outwardZ = neighbor.y - tile.y;
      if (exitTiles.has(tileKey) && outwardX === exitDirection.x && outwardZ === exitDirection.y) continue;
      const inward = new THREE.Vector3(-outwardX, 0, -outwardZ);
      const position = center.clone();
      position.x += outwardX * (TILE_SIZE * 0.5 - 0.12);
      position.y = CORRIDOR_LIGHT_HEIGHT;
      position.z += outwardZ * (TILE_SIZE * 0.5 - 0.12);
      candidates.push({
        tile,
        position,
        inward,
        rotationY: outwardZ !== 0 ? 0 : Math.PI / 2,
        hash: fixtureHash({ x: tile.x + outwardX * 53, y: tile.y + outwardZ * 53 }, level.mapDepth),
      });
    }
  }

  return candidates.sort((a, b) => a.hash - b.hash);
}

function nearestCandidate(
  candidates: WallFixtureCandidate[],
  position: THREE.Vector3,
): WallFixtureCandidate | undefined {
  return candidates.reduce<WallFixtureCandidate | undefined>((nearest, candidate) => {
    if (!nearest) return candidate;
    return candidate.position.distanceToSquared(position) < nearest.position.distanceToSquared(position)
      ? candidate
      : nearest;
  }, undefined);
}

function isSpacedFromSelected(candidate: WallFixtureCandidate, selected: WallFixtureCandidate[]): boolean {
  const minimumDistanceSquared = (FIXTURE_MIN_SPACING_TILES * TILE_SIZE) ** 2;
  return selected.every((fixture) => fixture.position.distanceToSquared(candidate.position) >= minimumDistanceSquared);
}

function directionVector(direction: LevelData["exitDirection"]): TileCoord {
  switch (direction) {
    case "north":
      return { x: 0, y: -1 };
    case "east":
      return { x: 1, y: 0 };
    case "south":
      return { x: 0, y: 1 };
    case "west":
      return { x: -1, y: 0 };
  }
}

function fixtureHash(tile: TileCoord, salt: number): number {
  let hash = Math.imul(tile.x + 37, 73856093) ^ Math.imul(tile.y + 71, 19349663) ^ Math.imul(salt + 11, 83492791);
  hash ^= hash >>> 16;
  return hash >>> 0;
}
