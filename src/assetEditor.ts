import * as THREE from "three";
import type { AssetSettings, EnemyAssetSettings, PickupAssetSettings, PlayerAssetSettings } from "./assetSettings";
import { type BruteAsset } from "./assets/enemies/brute/bruteAsset";
import { type EliteEnemyAsset } from "./assets/enemies/eliteEnemy/eliteEnemyAsset";
import {
  type LeanHunterAnimationId,
  type LeanHunterAnimationState,
  type LeanHunterRig,
} from "./assets/enemies/leanHunter/leanHunterAsset";
import { type VenomSpitterAsset } from "./assets/enemies/venomSpitter/venomSpitterAsset";
import { type IndustrialCrateAsset } from "./assets/environment/industrialCrate/industrialCrateAsset";
import { type ExitPortalAsset } from "./assets/environment/exitPortal/exitPortalAsset";
import { type AmmoPickupAsset } from "./assets/pickups/ammoPickup/ammoPickupAsset";
import { type EnergyPickupAsset } from "./assets/pickups/energyPickup/energyPickupAsset";
import { type HealthPickupAsset } from "./assets/pickups/healthPickup/healthPickupAsset";
import { createAssetFactory, type AssetFactory } from "./assetFactory";
import { createPlayerLocalAmbient } from "./playerLocalAmbient";
import { type PlayerAnimationState, type PlayerRig } from "./playerAsset";
import { createRenderer } from "./renderer";
import { addGameplayLighting } from "./sceneLighting";
import type { ResourceKind } from "./resourceTypes";

const ASSET_SETTINGS_BY_PATH = import.meta.glob("./assets/**/*.settings.json", {
  eager: true,
  import: "default",
}) as Record<string, AssetSettings>;

const EDITOR_ASSET_CREATORS = {
  player: (factory: AssetFactory) => factory.createPlayerRig(),
  "lean-hunter": (factory: AssetFactory) => factory.createLeanHunterRig(),
  "elite-enemy": (factory: AssetFactory) => factory.createEliteEnemyAsset(),
  "venom-spitter": (factory: AssetFactory) => factory.createVenomSpitterAsset(),
  brute: (factory: AssetFactory) => factory.createBruteAsset(),
  "health-pickup": (factory: AssetFactory) => factory.createPickupAsset("health"),
  "ammo-pickup": (factory: AssetFactory) => factory.createPickupAsset("ammo"),
  "energy-pickup": (factory: AssetFactory) => factory.createPickupAsset("energy"),
  "industrial-crate": (factory: AssetFactory) => factory.createEnvironmentAsset("industrial-crate"),
  "exit-portal": (factory: AssetFactory) => factory.createExitPortalAsset(),
} satisfies Record<string, (factory: AssetFactory) => EditorAsset>;

type AssetId = keyof typeof EDITOR_ASSET_CREATORS;
type AngleId = "head-on" | "side" | "behind" | "isometric";
type PlayerAnimationStateId = "idle" | "walk" | "fire" | "damaged" | "low-health";
type EditorOnlyAnimationStateId = "base-pose";
type AnimationStateId = EditorOnlyAnimationStateId | PlayerAnimationStateId | LeanHunterAnimationId;
type RenderModeId = "shaded" | "wireframe" | "bones";
type EditorAsset =
  | PlayerRig
  | LeanHunterRig
  | EliteEnemyAsset
  | VenomSpitterAsset
  | BruteAsset
  | HealthPickupAsset
  | AmmoPickupAsset
  | EnergyPickupAsset
  | IndustrialCrateAsset
  | ExitPortalAsset;

type AssetEditorState = {
  asset: AssetId;
  angle: AngleId;
  animation: AnimationStateId;
  cameraDistance: number;
  speed: number;
  playing: boolean;
  renderMode: RenderModeId;
  collisionVisible: boolean;
  assetSettings: Record<AssetId, AssetSettings>;
};

type CameraPose = {
  label: string;
  position: [number, number, number];
};

type CameraGizmo = {
  render: (viewCamera: THREE.Camera, viewTarget: THREE.Vector3) => void;
  resize: () => void;
  dispose: () => void;
};

type CameraTransition = {
  fromOffset: THREE.Vector3;
  toOffset: THREE.Vector3;
  elapsed: number;
  duration: number;
};

type AssetMetrics = {
  renderCalls: number;
  triangles: number;
};

type AssetDefinition = {
  label: string;
  targetY: number;
  collision: {
    radius: number;
    height: number;
  };
  animations: Array<{ id: AnimationStateId; label: string }>;
};

const ASSET_DISPLAY_ORDER: AssetId[] = [
  "player",
  "lean-hunter",
  "elite-enemy",
  "venom-spitter",
  "brute",
  "health-pickup",
  "ammo-pickup",
  "energy-pickup",
  "industrial-crate",
  "exit-portal",
];
const ASSET_SETTINGS = discoverAssetSettings();
const ASSETS = ASSET_DISPLAY_ORDER.filter((id) => id in ASSET_SETTINGS).map((id) => ({
  id,
  label: labelFromAssetId(id),
}));
const ASSET_DEFINITIONS = Object.fromEntries(
  ASSETS.map((asset) => [asset.id, createAssetDefinition(asset.id, ASSET_SETTINGS[asset.id])]),
) as Record<AssetId, AssetDefinition>;
const STANDARD_CAMERA_DISTANCE = 1;
const CAMERA_VIEW_RADIUS = 5.2;
const CAMERA_TRANSITION_SECONDS = 0.5;
const CAMERA_DISTANCE_STEP = 0.15;
const CAMERA_DISTANCE_MIN = 0.65;
const CAMERA_DISTANCE_MAX = 1.6;
const COLLISION_RADIUS_MIN = 0.1;
const COLLISION_RADIUS_MAX = 1.4;
const HEALTH_MIN = 1;
const HEALTH_MAX = 999;
const ASSET_SPEED_MIN = 0;
const ASSET_SPEED_MAX = 8;
const DROP_CHANCE_MIN = 0;
const DROP_CHANCE_MAX = 1;
const ENEMY_ATTACK_MAX = 999;
const ASSET_SETTINGS_ENDPOINTS = Object.fromEntries(
  ASSETS.map((asset) => [asset.id, `/__dev/asset-settings/${asset.id}`]),
) as Record<AssetId, string>;

const CAMERA_POSES: Record<AngleId, CameraPose> = {
  "head-on": { label: "Head On", position: [0, 1.65, -5.2] },
  side: { label: "Side", position: [5.2, 1.65, 0] },
  behind: { label: "Behind", position: [0, 1.65, 5.2] },
  isometric: { label: "Isometric", position: [4.2, 4.2, -4.2] },
};

const RENDER_MODES: Array<{ id: RenderModeId; label: string }> = [
  { id: "shaded", label: "Shaded" },
  { id: "wireframe", label: "Wireframe" },
  { id: "bones", label: "Bones" },
];

export function startAssetEditor(app: HTMLDivElement): void {
  const state = readStateFromUrl();
  app.className = "asset-editor";
  app.innerHTML = createAssetEditorMarkup(state);

  const canvasHost = app.querySelector<HTMLDivElement>("#assetEditorCanvas")!;
  const assetSelect = app.querySelector<HTMLSelectElement>("#assetSelect")!;
  const animationSelect = app.querySelector<HTMLSelectElement>("#animationSelect")!;
  const playToggle = app.querySelector<HTMLInputElement>("#playToggle")!;
  const speedInput = app.querySelector<HTMLInputElement>("#speedInput")!;
  const speedValue = app.querySelector<HTMLElement>("#speedValue")!;
  const cameraCloserButton = app.querySelector<HTMLButtonElement>("#cameraCloserButton")!;
  const cameraResetButton = app.querySelector<HTMLButtonElement>("#cameraResetButton")!;
  const cameraAwayButton = app.querySelector<HTMLButtonElement>("#cameraAwayButton")!;
  const cameraDistanceValue = app.querySelector<HTMLElement>("#cameraDistanceValue")!;
  const collisionToggle = app.querySelector<HTMLInputElement>("#collisionToggle")!;
  const assetHealthField = app.querySelector<HTMLElement>("#assetHealthField")!;
  const assetCollisionRadiusInput = app.querySelector<HTMLInputElement>("#assetCollisionRadiusInput")!;
  const assetHealthInput = app.querySelector<HTMLInputElement>("#assetHealthInput")!;
  const assetSpeedField = app.querySelector<HTMLElement>("#assetSpeedField")!;
  const assetSpeedLabel = app.querySelector<HTMLElement>("#assetSpeedLabel")!;
  const assetSpeedInput = app.querySelector<HTMLInputElement>("#assetSpeedInput")!;
  const pickupResourcesField = app.querySelector<HTMLElement>("#pickupResourcesField")!;
  const pickupResourcesInputs = Array.from(
    app.querySelectorAll<HTMLInputElement>("[data-pickup-resource]"),
  );
  const enemyCombatField = app.querySelector<HTMLElement>("#enemyCombatField")!;
  const enemyAttackInputs = Array.from(app.querySelectorAll<HTMLInputElement>("[data-enemy-attack-field]"));
  const enemyDropChanceInput = app.querySelector<HTMLInputElement>("#enemyDropChanceInput")!;
  const enemyDropEntryInputs = Array.from(app.querySelectorAll<HTMLInputElement>("[data-enemy-drop-kind]"));
  const assetSettingsSaveButton = app.querySelector<HTMLButtonElement>("#assetSettingsSaveButton")!;
  const assetSettingsStatus = app.querySelector<HTMLElement>("#assetSettingsStatus")!;
  const renderCalls = app.querySelector<HTMLElement>("#renderCalls")!;
  const triangleCount = app.querySelector<HTMLElement>("#triangleCount")!;
  const gizmoHost = app.querySelector<HTMLDivElement>("#assetEditorGizmo")!;

  const renderer = createRenderer({ preserveDrawingBuffer: true, pixelRatio: 2 });
  canvasHost.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05080a);
  scene.fog = new THREE.Fog(0x05080a, 12, 24);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  const target = new THREE.Vector3(0, ASSET_DEFINITIONS[state.asset].targetY, 0);
  const cameraGizmo = createCameraGizmo(gizmoHost, setCameraDirection);
  const loader = new THREE.TextureLoader();
  const assetFactory = createAssetFactory(loader, renderer.capabilities.getMaxAnisotropy());
  const playerLocalAmbient = createPlayerLocalAmbient();
  const rigs = Object.fromEntries(
    ASSETS.map((asset) => [asset.id, EDITOR_ASSET_CREATORS[asset.id](assetFactory)]),
  ) as Record<AssetId, EditorAsset>;
  for (const asset of ASSETS) {
    if (asset.id !== "player") playerLocalAmbient.applyToObject(rigs[asset.id].root);
  }
  playerLocalAmbient.update(new THREE.Vector3());
  scene.add(...ASSETS.map((asset) => rigs[asset.id].root));
  const boneHelpers = Object.fromEntries(
    ASSETS.filter((asset) => hasSkeleton(rigs[asset.id])).map((asset) => [
      asset.id,
      createBoneHelper(rigs[asset.id].root, boneHelperColor(asset.id)),
    ]),
  ) as Partial<Record<AssetId, THREE.SkeletonHelper>>;
  scene.add(...Object.values(boneHelpers));

  const floor = createInspectionFloor();
  scene.add(floor);
  const collisionVolume = createCollisionVolume();
  scene.add(collisionVolume.root);
  const lightAnchor = new THREE.Group();
  scene.add(lightAnchor);
  addGameplayLighting(scene, lightAnchor);
  addAxisMarkers(scene);

  const clock = new THREE.Clock();
  let disposed = false;
  let firePulseTimer = 0;
  let dragStart: { x: number; angle: number } | null = null;
  let customOrbitAngle = 0;
  let customOrbitRadius = 5.2;
  let usingCustomOrbit = false;
  let customCameraDirection: THREE.Vector3 | null = null;
  let cameraTransition: CameraTransition | null = null;

  function activeRig(): EditorAsset {
    return rigs[state.asset];
  }

  function applyActiveAsset(): void {
    target.y = ASSET_DEFINITIONS[state.asset].targetY;
    for (const asset of ASSETS) {
      rigs[asset.id].root.visible = state.asset === asset.id;
    }
    applyBoneHelperVisibility();
    applyCollisionVolume();
  }

  function applyStateToControls(): void {
    const settings = activeAssetSettings();
    assetSelect.value = state.asset;
    syncAnimationOptions(animationSelect, state);
    animationSelect.value = state.animation;
    playToggle.checked = state.playing;
    speedInput.value = state.speed.toString();
    speedValue.textContent = `${state.speed.toFixed(1)}x`;
    cameraDistanceValue.textContent = `${state.cameraDistance.toFixed(2)}x`;
    cameraCloserButton.disabled = state.cameraDistance <= CAMERA_DISTANCE_MIN;
    cameraResetButton.disabled =
      state.cameraDistance === STANDARD_CAMERA_DISTANCE && !usingCustomOrbit && customCameraDirection === null;
    cameraAwayButton.disabled = state.cameraDistance >= CAMERA_DISTANCE_MAX;
    collisionToggle.checked = state.collisionVisible;
    assetCollisionRadiusInput.value = settings.collision.radius.toFixed(2);
    assetHealthField.hidden = !hasHealth(settings);
    if (hasHealth(settings)) {
      assetHealthInput.value = assetHealthValue(settings).toString();
    }
    assetSpeedField.hidden = !hasMovementSpeed(settings);
    if (hasMovementSpeed(settings)) {
      assetSpeedLabel.textContent = settings.kind === "enemy" ? "Movement Speed" : "Player Speed";
      assetSpeedInput.value = getMovementSpeed(settings).toFixed(2);
    }
    pickupResourcesField.hidden = settings.kind !== "pickup";
    if (settings.kind === "pickup") {
      for (const input of pickupResourcesInputs) {
        input.value = String(settings.resources[input.dataset.pickupResource as keyof typeof settings.resources] ?? 0);
      }
    }
    enemyCombatField.hidden = settings.kind !== "enemy";
    if (settings.kind === "enemy") {
      const attack = primaryEditableAttack(settings);
      enemyAttackInputs.forEach((input) => {
        input.value = enemyAttackInputValue(attack, input.dataset.enemyAttackField).toString();
      });
      enemyDropChanceInput.value = settings.dropTable.chance.toFixed(3);
      enemyDropEntryInputs.forEach((input) => {
        const entry = enemyDropEntry(settings, toResourceKind(input.dataset.enemyDropKind));
        const field = input.dataset.enemyDropField;
        input.value = String(field === "amount" ? entry.amount : entry.weight);
      });
    }
    assetSettingsSaveButton.disabled = false;

    const usingCustomCamera = usingCustomOrbit || customCameraDirection !== null;
    for (const button of app.querySelectorAll<HTMLButtonElement>("[data-angle]")) {
      button.classList.toggle("selected", button.dataset.angle === state.angle && !usingCustomCamera);
    }
    for (const button of app.querySelectorAll<HTMLButtonElement>("[data-render-mode]")) {
      button.classList.toggle("selected", button.dataset.renderMode === state.renderMode);
    }

  }

  function syncUrl(): void {
    const params = new URLSearchParams();
    params.set("asset", state.asset);
    params.set("angle", state.angle);
    params.set("state", state.animation);
    params.set("speed", state.speed.toFixed(1));
    if (state.cameraDistance !== STANDARD_CAMERA_DISTANCE) {
      params.set("distance", state.cameraDistance.toFixed(2));
    }
    if (state.renderMode !== "shaded") {
      params.set("mode", state.renderMode);
    }
    if (!state.collisionVisible) params.set("hideCollision", "1");
    if (!state.playing) params.set("paused", "1");
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }

  function setAngle(angle: AngleId): void {
    state.angle = angle;
    usingCustomOrbit = false;
    customCameraDirection = null;
    startCameraTransition();
    applyStateToControls();
    syncUrl();
  }

  function setCameraDirection(direction: THREE.Vector3): void {
    const snappedAngle = angleForCameraDirection(direction);
    if (snappedAngle) {
      setAngle(snappedAngle);
      return;
    }

    customCameraDirection = direction.clone().normalize();
    usingCustomOrbit = false;
    startCameraTransition();
    applyStateToControls();
    syncUrl();
  }

  function moveCameraDistance(delta: number): void {
    state.cameraDistance = clamp(
      Number((state.cameraDistance + delta).toFixed(2)),
      CAMERA_DISTANCE_MIN,
      CAMERA_DISTANCE_MAX,
    );
    startCameraTransition();
    applyStateToControls();
    syncUrl();
  }

  function resetCameraPosition(): void {
    state.cameraDistance = STANDARD_CAMERA_DISTANCE;
    usingCustomOrbit = false;
    customCameraDirection = null;
    startCameraTransition();
    applyStateToControls();
    syncUrl();
  }

  function setRenderMode(renderMode: RenderModeId): void {
    state.renderMode = renderMode;
    applyRenderMode();
    applyStateToControls();
    syncUrl();
  }

  function activeAssetSettings(): AssetSettings {
    return state.assetSettings[state.asset];
  }

  function setAssetCollisionRadius(radius: number): void {
    activeAssetSettings().collision.radius = clamp(radius, COLLISION_RADIUS_MIN, COLLISION_RADIUS_MAX);
    applyCollisionVolume();
    applyStateToControls();
    setAssetSettingsStatus("Unsaved changes");
  }

  function setAssetHealth(health: number): void {
    const settings = activeAssetSettings();
    if (!hasHealth(settings)) return;
    if (settings.kind === "enemy") {
      settings.health.base = Math.round(clamp(health, HEALTH_MIN, HEALTH_MAX));
    } else {
      settings.health = Math.round(clamp(health, HEALTH_MIN, HEALTH_MAX));
    }
    applyStateToControls();
    setAssetSettingsStatus("Unsaved changes");
  }

  function setAssetSpeed(speed: number): void {
    const settings = activeAssetSettings();
    if (!hasMovementSpeed(settings)) return;
    setMovementSpeed(settings, clamp(speed, ASSET_SPEED_MIN, ASSET_SPEED_MAX));
    applyStateToControls();
    setAssetSettingsStatus("Unsaved changes");
  }

  function setPickupResource(kind: keyof PickupAssetSettings["resources"], amount: number): void {
    const settings = activeAssetSettings();
    if (settings.kind !== "pickup") return;
    settings.resources[kind] = Math.round(clamp(amount, 0, HEALTH_MAX));
    applyStateToControls();
    setAssetSettingsStatus("Unsaved changes");
  }

  function setEnemyAttackField(field: string | undefined, value: number): void {
    const settings = activeAssetSettings();
    if (settings.kind !== "enemy") return;
    const attack = primaryEditableAttack(settings);

    if (field === "damage") {
      attack.damage = Math.round(clamp(value, 1, ENEMY_ATTACK_MAX));
    } else if (field === "cooldown") {
      attack.cooldown = clamp(value, 0.01, 10);
    } else if (field === "range") {
      attack.range = clamp(value, 0.01, 50);
    } else {
      return;
    }

    applyStateToControls();
    setAssetSettingsStatus("Unsaved changes");
  }

  function setEnemyDropChance(chance: number): void {
    const settings = activeAssetSettings();
    if (settings.kind !== "enemy") return;
    settings.dropTable.chance = clamp(chance, DROP_CHANCE_MIN, DROP_CHANCE_MAX);
    applyStateToControls();
    setAssetSettingsStatus("Unsaved changes");
  }

  function setEnemyDropEntryField(kind: ResourceKind, field: string | undefined, value: number): void {
    const settings = activeAssetSettings();
    if (settings.kind !== "enemy") return;
    const entry = enemyDropEntry(settings, kind);

    if (field === "amount") {
      entry.amount = Math.round(clamp(value, 1, HEALTH_MAX));
    } else if (field === "weight") {
      entry.weight = Math.round(clamp(value, 1, HEALTH_MAX));
    } else {
      return;
    }

    applyStateToControls();
    setAssetSettingsStatus("Unsaved changes");
  }

  function setCollisionVisible(visible: boolean): void {
    state.collisionVisible = visible;
    applyCollisionVolume();
    applyStateToControls();
    syncUrl();
  }

  function applyCollisionVolume(): void {
    const settings = activeAssetSettings();
    updateCollisionVolume(collisionVolume, settings.collision.radius, settings.collision.height);
    collisionVolume.root.visible = state.collisionVisible;
  }

  function setAssetSettingsStatus(text: string): void {
    assetSettingsStatus.textContent = text;
  }

  async function saveActiveAssetSettings(): Promise<void> {
    assetSettingsSaveButton.disabled = true;
    setAssetSettingsStatus("Saving...");

    try {
      const response = await fetch(ASSET_SETTINGS_ENDPOINTS[state.asset], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(activeAssetSettings()),
      });
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("Asset settings endpoint missing. Restart the Vite dev server.");
        }
        throw new Error(await response.text());
      }
      setAssetSettingsStatus("Saved");
    } catch (error) {
      console.error(error);
      setAssetSettingsStatus(error instanceof Error ? error.message : "Save failed");
    } finally {
      assetSettingsSaveButton.disabled = false;
    }
  }

  function applyRenderMode(): void {
    for (const asset of ASSETS) {
      setWireframe(rigs[asset.id].root, state.renderMode === "wireframe" || state.renderMode === "bones");
    }
    applyBoneHelperVisibility();
  }

  function applyBoneHelperVisibility(): void {
    for (const [asset, helper] of Object.entries(boneHelpers) as Array<[AssetId, THREE.SkeletonHelper]>) {
      helper.visible = state.renderMode === "bones" && state.asset === asset;
    }
  }

  function cameraAnchorPosition(): THREE.Vector3 {
    if (customCameraDirection) {
      return cameraPositionForDirection(customCameraDirection, target);
    }

    if (usingCustomOrbit) {
      return new THREE.Vector3(
        Math.sin(customOrbitAngle) * customOrbitRadius,
        state.angle === "isometric" ? 4.2 : 1.65,
        Math.cos(customOrbitAngle) * customOrbitRadius,
      );
    }

    return new THREE.Vector3().fromArray(CAMERA_POSES[state.angle].position);
  }

  function desiredCameraOffset(): THREE.Vector3 {
    return cameraAnchorPosition().sub(target).multiplyScalar(state.cameraDistance);
  }

  function applyCameraOffset(offset: THREE.Vector3): void {
    camera.position.copy(target).add(offset);
    lookAtWithStableVerticalUp(camera, target);
  }

  function startCameraTransition(): void {
    const fromOffset = camera.position.clone().sub(target);
    const toOffset = desiredCameraOffset();

    if (fromOffset.distanceTo(toOffset) < 0.001) {
      cameraTransition = null;
      applyCameraOffset(toOffset);
      return;
    }

    cameraTransition = {
      fromOffset,
      toOffset,
      elapsed: 0,
      duration: CAMERA_TRANSITION_SECONDS,
    };
  }

  function updateCamera(dt: number): void {
    if (!cameraTransition) {
      applyCameraOffset(desiredCameraOffset());
      return;
    }

    cameraTransition.elapsed += dt;
    const progress = clamp(cameraTransition.elapsed / cameraTransition.duration, 0, 1);
    const easedProgress = easeInOutCubic(progress);
    applyCameraOffset(cameraTransition.fromOffset.clone().lerp(cameraTransition.toOffset, easedProgress));

    if (progress >= 1) {
      cameraTransition = null;
    }
  }

  function resize(): void {
    const width = Math.max(canvasHost.clientWidth, 1);
    const height = Math.max(canvasHost.clientHeight, 1);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    cameraGizmo.resize();
  }

  function playerAnimationState(dt: number): PlayerAnimationState {
    const moving = state.animation === "walk";
    const damaged = state.animation === "damaged";
    const lowHealth = state.animation === "low-health";

    if (state.animation === "fire" && state.playing) {
      firePulseTimer -= dt;
      if (firePulseTimer <= 0) {
        (rigs.player as PlayerRig).triggerFire();
        firePulseTimer = 0.72;
      }
    }

    return {
      moving,
      moveSpeed: moving ? 6.2 : 4.8,
      damaged,
      lowHealth,
    };
  }

  function leanHunterAnimationState(): LeanHunterAnimationState {
    return {
      animation: isLeanHunterAnimationId(state.animation) ? state.animation : "idle",
    };
  }

  function animate(): void {
    if (disposed) return;
    requestAnimationFrame(animate);

    const rawDt = Math.min(clock.getDelta(), 0.033);
    const dt = state.playing ? rawDt * state.speed : 0;
    updateCamera(rawDt);
    if (state.asset === "player") {
      const rig = rigs.player as PlayerRig;
      if (state.animation === "base-pose") {
        rig.applyBasePose();
      } else {
        rig.update(playerAnimationState(dt), dt);
      }
    } else if (isEnemyAsset(state.asset)) {
      const rig = rigs[state.asset] as LeanHunterRig | EliteEnemyAsset | VenomSpitterAsset | BruteAsset;
      if (state.animation === "base-pose") {
        rig.applyBasePose();
      } else {
        rig.update(leanHunterAnimationState(), dt);
      }
    }
    boneHelpers[state.asset]?.updateMatrixWorld(true);
    renderer.render(scene, camera);
    cameraGizmo.render(camera, target);
    const assetMetrics = measureAsset(activeRig().root);
    renderCalls.textContent = assetMetrics.renderCalls.toString();
    triangleCount.textContent = assetMetrics.triangles.toLocaleString();
  }

  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-angle]")) {
    button.addEventListener("click", () => setAngle(toAngleId(button.dataset.angle)));
  }

  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-render-mode]")) {
    button.addEventListener("click", () => setRenderMode(toRenderModeId(button.dataset.renderMode)));
  }

  cameraCloserButton.addEventListener("click", () => moveCameraDistance(-CAMERA_DISTANCE_STEP));
  cameraResetButton.addEventListener("click", resetCameraPosition);
  cameraAwayButton.addEventListener("click", () => moveCameraDistance(CAMERA_DISTANCE_STEP));

  assetSelect.addEventListener("change", () => {
    state.asset = toAssetId(assetSelect.value);
    state.animation = ensureAnimationForAsset(state.asset, state.animation);
    firePulseTimer = 0;
    setAssetSettingsStatus("Loaded from code");
    applyActiveAsset();
    applyStateToControls();
    syncUrl();
  });

  animationSelect.addEventListener("change", () => {
    state.animation = toAnimationStateId(state.asset, animationSelect.value);
    firePulseTimer = 0;
    if (state.asset === "player" && state.animation === "fire") (rigs.player as PlayerRig).triggerFire();
    applyStateToControls();
    syncUrl();
  });

  playToggle.addEventListener("change", () => {
    state.playing = playToggle.checked;
    applyStateToControls();
    syncUrl();
  });

  speedInput.addEventListener("input", () => {
    state.speed = clamp(Number(speedInput.value), 0.1, 2.5);
    applyStateToControls();
    syncUrl();
  });

  collisionToggle.addEventListener("change", () => {
    setCollisionVisible(collisionToggle.checked);
  });

  assetCollisionRadiusInput.addEventListener("input", () => {
    setAssetCollisionRadius(Number(assetCollisionRadiusInput.value));
  });

  assetHealthInput.addEventListener("input", () => {
    setAssetHealth(Number(assetHealthInput.value));
  });

  assetSpeedInput.addEventListener("input", () => {
    setAssetSpeed(Number(assetSpeedInput.value));
  });

  for (const input of pickupResourcesInputs) {
    input.addEventListener("input", () => {
      setPickupResource(input.dataset.pickupResource as keyof PickupAssetSettings["resources"], Number(input.value));
    });
  }

  for (const input of enemyAttackInputs) {
    input.addEventListener("input", () => {
      setEnemyAttackField(input.dataset.enemyAttackField, Number(input.value));
    });
  }

  enemyDropChanceInput.addEventListener("input", () => {
    setEnemyDropChance(Number(enemyDropChanceInput.value));
  });

  for (const input of enemyDropEntryInputs) {
    input.addEventListener("input", () => {
      setEnemyDropEntryField(
        toResourceKind(input.dataset.enemyDropKind),
        input.dataset.enemyDropField,
        Number(input.value),
      );
    });
  }

  assetSettingsSaveButton.addEventListener("click", () => {
    void saveActiveAssetSettings();
  });

  renderer.domElement.addEventListener("pointerdown", (event) => {
    renderer.domElement.setPointerCapture(event.pointerId);
    cameraTransition = null;
    const cameraOffset = camera.position.clone().sub(target).divideScalar(state.cameraDistance);
    customOrbitAngle = Math.atan2(cameraOffset.x, cameraOffset.z);
    customOrbitRadius = Math.max(Math.hypot(cameraOffset.x, cameraOffset.z), CAMERA_VIEW_RADIUS);
    dragStart = { x: event.clientX, angle: customOrbitAngle };
  });

  renderer.domElement.addEventListener("pointermove", (event) => {
    if (!dragStart) return;
    usingCustomOrbit = true;
    customCameraDirection = null;
    customOrbitAngle = dragStart.angle + (event.clientX - dragStart.x) * 0.01;
    applyStateToControls();
  });

  renderer.domElement.addEventListener("pointerup", (event) => {
    renderer.domElement.releasePointerCapture(event.pointerId);
    dragStart = null;
  });

  window.addEventListener("resize", resize);
  window.addEventListener("pagehide", () => {
    disposed = true;
    cameraGizmo.dispose();
    renderer.dispose();
  });

  applyActiveAsset();
  applyCollisionVolume();
  applyStateToControls();
  applyRenderMode();
  resize();
  if (state.asset === "player" && state.animation === "fire") (rigs.player as PlayerRig).triggerFire();
  animate();
}

function createAssetEditorMarkup(state: AssetEditorState): string {
  const angleButtons = Object.entries(CAMERA_POSES)
    .map(
      ([id, pose]) =>
        `<button type="button" data-angle="${id}" class="${id === state.angle ? "selected" : ""}">${pose.label}</button>`,
    )
    .join("");

  const assetOptions = ASSETS.map(
    (asset) => `<option value="${asset.id}" ${asset.id === state.asset ? "selected" : ""}>${asset.label}</option>`,
  ).join("");

  const stateOptions = animationOptions(state.asset).map(
    (entry) =>
      `<option value="${entry.id}" ${entry.id === state.animation ? "selected" : ""}>${entry.label}</option>`,
  ).join("");

  const renderModeButtons = RENDER_MODES.map(
    (mode) =>
      `<button type="button" data-render-mode="${mode.id}" class="${mode.id === state.renderMode ? "selected" : ""}">${mode.label}</button>`,
  ).join("");

  return `
    <main class="asset-editor-shell">
      <section class="asset-editor-stage" aria-label="Asset preview">
        <div id="assetEditorCanvas" class="asset-editor-canvas"></div>
        <div id="assetEditorGizmo" class="asset-editor-gizmo" aria-label="Camera orientation gizmo"></div>
        <div class="asset-editor-readout">
          <div><span>Render Calls</span><strong id="renderCalls">0</strong></div>
          <div><span>Triangles</span><strong id="triangleCount">0</strong></div>
        </div>
      </section>
      <aside class="asset-editor-panel" aria-label="Asset editor controls">
        <div class="asset-editor-title">
          <h1>Asset Editor</h1>
        </div>
        <label>
          <span>Asset</span>
          <select id="assetSelect">${assetOptions}</select>
        </label>
        <section class="asset-editor-section" aria-label="Render settings">
          <h2>Render Settings</h2>
          <div class="control-group">
            <span>Angle</span>
            <div class="segmented-controls">${angleButtons}</div>
          </div>
          <div class="control-group">
            <span>Camera Distance <strong id="cameraDistanceValue">${state.cameraDistance.toFixed(2)}x</strong></span>
            <div class="segmented-controls camera-distance-controls">
              <button id="cameraCloserButton" type="button">Closer</button>
              <button id="cameraResetButton" type="button">Reset</button>
              <button id="cameraAwayButton" type="button">Away</button>
            </div>
          </div>
          <label>
            <span>Animation</span>
            <select id="animationSelect">${stateOptions}</select>
          </label>
          <div class="control-group">
            <span>Render Mode</span>
            <div class="segmented-controls">${renderModeButtons}</div>
          </div>
          <label class="toggle-row">
            <span>Show Collision Volume</span>
            <input id="collisionToggle" type="checkbox" ${state.collisionVisible ? "checked" : ""} />
          </label>
          <label class="toggle-row">
            <span>Playback</span>
            <input id="playToggle" type="checkbox" ${state.playing ? "checked" : ""} />
          </label>
          <label>
            <span>Speed <strong id="speedValue">${state.speed.toFixed(1)}x</strong></span>
            <input id="speedInput" type="range" min="0.1" max="2.5" step="0.1" value="${state.speed}" />
          </label>
        </section>
        <section class="asset-editor-section" aria-label="Asset settings">
          <h2>Asset Settings</h2>
          <label>
            <span>Collision Radius</span>
            <input
              id="assetCollisionRadiusInput"
              type="number"
              min="${COLLISION_RADIUS_MIN}"
              max="${COLLISION_RADIUS_MAX}"
              step="0.01"
              value="${state.assetSettings[state.asset].collision.radius.toFixed(2)}"
            />
          </label>
          <label id="assetHealthField">
            <span>Health</span>
            <input
              id="assetHealthInput"
              type="number"
              min="${HEALTH_MIN}"
              max="${HEALTH_MAX}"
              step="1"
              value="${assetHealthValue(state.assetSettings[state.asset])}"
            />
          </label>
          <label id="assetSpeedField">
            <span id="assetSpeedLabel">Movement Speed</span>
            <input
              id="assetSpeedInput"
              type="number"
              min="${ASSET_SPEED_MIN}"
              max="${ASSET_SPEED_MAX}"
              step="0.01"
              value="${assetSpeedValue(state.assetSettings[state.asset]).toFixed(2)}"
            />
          </label>
          <div id="pickupResourcesField" class="asset-settings-grid">
            <label>
              <span>Health Grant</span>
              <input data-pickup-resource="health" type="number" min="0" max="${HEALTH_MAX}" step="1" value="0" />
            </label>
            <label>
              <span>Ammo Grant</span>
              <input data-pickup-resource="ammo" type="number" min="0" max="${HEALTH_MAX}" step="1" value="0" />
            </label>
            <label>
              <span>Energy Grant</span>
              <input data-pickup-resource="energy" type="number" min="0" max="${HEALTH_MAX}" step="1" value="0" />
            </label>
          </div>
          <div id="enemyCombatField" class="enemy-settings-stack">
            <div class="enemy-settings-group">
              <h3>Primary Attack</h3>
              <div class="asset-settings-grid">
                <label>
                  <span>Damage</span>
                  <input data-enemy-attack-field="damage" type="number" min="1" max="${ENEMY_ATTACK_MAX}" step="1" value="1" />
                </label>
                <label>
                  <span>Cooldown</span>
                  <input data-enemy-attack-field="cooldown" type="number" min="0.01" max="10" step="0.01" value="1" />
                </label>
                <label>
                  <span>Range</span>
                  <input data-enemy-attack-field="range" type="number" min="0.01" max="50" step="0.01" value="1" />
                </label>
              </div>
            </div>
            <div class="enemy-settings-group">
              <h3>Drop Table</h3>
              <label>
                <span>Drop Chance</span>
                <input id="enemyDropChanceInput" type="number" min="${DROP_CHANCE_MIN}" max="${DROP_CHANCE_MAX}" step="0.001" value="0" />
              </label>
              <div class="drop-table-editor">
                ${dropTableEditorRow("health", "Health")}
                ${dropTableEditorRow("ammo", "Ammo")}
                ${dropTableEditorRow("energy", "Energy")}
              </div>
            </div>
          </div>
          <div class="asset-settings-actions">
            <button id="assetSettingsSaveButton" type="button">Save Asset Settings</button>
            <span id="assetSettingsStatus">Loaded from code</span>
          </div>
        </section>
      </aside>
    </main>
  `;
}

function readStateFromUrl(): AssetEditorState {
  const params = new URLSearchParams(window.location.search);
  const asset = toAssetId(params.get("asset"));

  return {
    asset,
    angle: toAngleId(params.get("angle")),
    animation: toAnimationStateId(asset, params.get("state") ?? params.get("animation")),
    cameraDistance: clamp(Number(params.get("distance") ?? STANDARD_CAMERA_DISTANCE), CAMERA_DISTANCE_MIN, CAMERA_DISTANCE_MAX),
    speed: clamp(Number(params.get("speed") ?? "1"), 0.1, 2.5),
    playing: params.get("paused") !== "1",
    renderMode: toRenderModeId(params.get("mode")),
    collisionVisible: params.get("hideCollision") !== "1",
    assetSettings: defaultAssetSettings(),
  };
}

function defaultAssetSettings(): Record<AssetId, AssetSettings> {
  return Object.fromEntries(ASSETS.map((asset) => [asset.id, cloneAssetSettings(ASSET_SETTINGS[asset.id])])) as Record<
    AssetId,
    AssetSettings
  >;
}

function cloneAssetSettings<T extends AssetSettings>(settings: T): T {
  return structuredClone(settings);
}

function discoverAssetSettings(): Record<AssetId, AssetSettings> {
  const discovered = new Map<AssetId, AssetSettings>();
  for (const [path, settings] of Object.entries(ASSET_SETTINGS_BY_PATH)) {
    const id = assetIdFromSettingsPath(path);
    if (!id || !isEditorAssetId(id)) continue;
    discovered.set(id, settings);
  }
  return Object.fromEntries(discovered) as Record<AssetId, AssetSettings>;
}

function assetIdFromSettingsPath(path: string): string | null {
  const match = path.match(/\/([^/]+)\/[^/]+\.settings\.json$/);
  return match ? camelToKebab(match[1]) : null;
}

function camelToKebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function labelFromAssetId(id: AssetId): string {
  if (id === "elite-enemy") return "Elite Hunter";
  return id
    .split("-")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function createAssetDefinition(id: AssetId, settings: AssetSettings): AssetDefinition {
  return {
    label: labelFromAssetId(id),
    targetY: assetTargetY(id, settings),
    collision: settings.collision,
    animations: animationDefinitionsForAsset(id, settings),
  };
}

function assetTargetY(id: AssetId, settings: AssetSettings): number {
  if (id === "exit-portal") return 1.2;
  if (settings.kind === "pickup") return Math.max(0.45, settings.collision.height * 0.5);
  return settings.collision.height * 0.5;
}

function animationDefinitionsForAsset(
  id: AssetId,
  settings: AssetSettings,
): Array<{ id: AnimationStateId; label: string }> {
  if (id === "player") {
    return [
      { id: "base-pose", label: "Base Pose" },
      { id: "idle", label: "Idle" },
      { id: "walk", label: "Walk" },
      { id: "fire", label: "Fire" },
      { id: "damaged", label: "Damaged" },
      { id: "low-health", label: "Low Health" },
    ];
  }

  if (settings.kind === "enemy") {
    const attackLabel = settings.attacks[0]?.kind === "ranged" ? "Attack" : "Melee";
    return [
      { id: "base-pose", label: "Base Pose" },
      { id: "idle", label: "Idle" },
      { id: "walk", label: "Walk" },
      { id: "melee", label: attackLabel },
      { id: "death", label: "Death" },
    ];
  }

  return [{ id: "idle", label: "Idle" }];
}

function hasHealth(settings: AssetSettings): settings is EnemyAssetSettings | PlayerAssetSettings {
  return settings.kind === "enemy" || settings.kind === "player";
}

function hasMovementSpeed(settings: AssetSettings): settings is EnemyAssetSettings | PlayerAssetSettings {
  return settings.kind === "enemy" || (settings.kind === "player" && settings.movement !== undefined);
}

function getMovementSpeed(settings: EnemyAssetSettings | PlayerAssetSettings): number {
  return settings.kind === "enemy" ? settings.movement.speed : settings.movement?.speed ?? 0;
}

function setMovementSpeed(settings: EnemyAssetSettings | PlayerAssetSettings, speed: number): void {
  if (settings.kind === "enemy") {
    settings.movement.speed = speed;
    return;
  }
  settings.movement = { speed };
}

function assetHealthValue(settings: AssetSettings): number {
  if (settings.kind === "enemy") return settings.health.base;
  return hasHealth(settings) ? settings.health : 0;
}

function assetSpeedValue(settings: AssetSettings): number {
  return hasMovementSpeed(settings) ? getMovementSpeed(settings) : 0;
}

function primaryEditableAttack(settings: EnemyAssetSettings): EnemyAssetSettings["attacks"][number] {
  const melee = settings.attacks.find((attack) => attack.kind === "melee");
  return melee ?? settings.attacks[0];
}

function enemyAttackInputValue(attack: EnemyAssetSettings["attacks"][number], field: string | undefined): number {
  if (field === "damage") return attack.damage;
  if (field === "cooldown") return attack.cooldown;
  if (field === "range") return attack.range;
  return 0;
}

function enemyDropEntry(settings: EnemyAssetSettings, kind: ResourceKind): EnemyAssetSettings["dropTable"]["entries"][number] {
  let entry = settings.dropTable.entries.find((candidate) => candidate.kind === kind);
  if (!entry) {
    entry = { kind, weight: 1, amount: 1 };
    settings.dropTable.entries.push(entry);
  }
  return entry;
}

function toResourceKind(value: string | undefined): ResourceKind {
  if (value === "health" || value === "ammo" || value === "energy") return value;
  return "health";
}

function dropTableEditorRow(kind: ResourceKind, label: string): string {
  return `
    <div class="drop-table-row">
      <span>${label}</span>
      <label>
        <span>Weight</span>
        <input data-enemy-drop-kind="${kind}" data-enemy-drop-field="weight" type="number" min="1" max="${HEALTH_MAX}" step="1" value="1" />
      </label>
      <label>
        <span>Amount</span>
        <input data-enemy-drop-kind="${kind}" data-enemy-drop-field="amount" type="number" min="1" max="${HEALTH_MAX}" step="1" value="1" />
      </label>
    </div>
  `;
}

function setWireframe(root: THREE.Object3D, enabled: boolean): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    setMaterialWireframe(object.material, enabled);
  });
}

function setMaterialWireframe(material: THREE.Material | THREE.Material[], enabled: boolean): void {
  if (Array.isArray(material)) {
    material.forEach((entry) => setMaterialWireframe(entry, enabled));
    return;
  }
  if (!("wireframe" in material)) return;
  material.wireframe = enabled;
  material.needsUpdate = true;
}

function hasSkeleton(asset: EditorAsset): asset is EditorAsset & { skeleton: THREE.Skeleton } {
  return "skeleton" in asset;
}

function isEnemyAsset(asset: AssetId): boolean {
  return statefulAssetSettings(asset).kind === "enemy";
}

function statefulAssetSettings(asset: AssetId): AssetSettings {
  return ASSET_SETTINGS[asset];
}

function boneHelperColor(asset: AssetId): THREE.ColorRepresentation {
  if (asset === "player") return 0xffc857;
  if (asset === "brute") return 0x86ff52;
  if (asset === "venom-spitter") return 0x8dff38;
  if (asset === "elite-enemy") return 0xff3434;
  return 0xff5a8a;
}

function createBoneHelper(root: THREE.Object3D, color: THREE.ColorRepresentation): THREE.SkeletonHelper {
  const helper = new THREE.SkeletonHelper(root);
  helper.visible = false;
  helper.frustumCulled = false;
  helper.material = new THREE.LineBasicMaterial({
    color,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    opacity: 0.95,
  });
  helper.renderOrder = 10;
  return helper;
}

function measureAsset(root: THREE.Object3D): AssetMetrics {
  const metrics: AssetMetrics = { renderCalls: 0, triangles: 0 };

  root.traverseVisible((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const renderCalls = countMeshRenderCalls(object);
    if (renderCalls === 0) return;

    metrics.renderCalls += renderCalls;
    metrics.triangles += countRenderedTriangles(object.geometry, object.material);
  });

  return metrics;
}

function countMeshRenderCalls(mesh: THREE.Mesh): number {
  const material = mesh.material;
  if (Array.isArray(material)) {
    if (mesh.geometry.groups.length === 0) {
      return material.filter((entry) => entry.visible).length;
    }

    return mesh.geometry.groups.filter((group) => material[group.materialIndex ?? 0]?.visible ?? true).length;
  }

  return material.visible ? 1 : 0;
}

function countRenderedTriangles(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
): number {
  const indexCount = geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0;
  const drawStart = Math.min(geometry.drawRange.start, indexCount);
  const drawEnd =
    geometry.drawRange.count === Infinity
      ? indexCount
      : Math.min(indexCount, geometry.drawRange.start + geometry.drawRange.count);

  if (geometry.groups.length === 0) {
    return Math.floor(Math.max(0, drawEnd - drawStart) / 3);
  }

  return geometry.groups.reduce((total, group) => {
    if (!isGroupMaterialVisible(material, group.materialIndex ?? 0)) return total;
    const groupStart = Math.max(group.start, drawStart);
    const groupEnd = Math.min(group.start + group.count, drawEnd);
    return total + Math.floor(Math.max(0, groupEnd - groupStart) / 3);
  }, 0);
}

function isGroupMaterialVisible(material: THREE.Material | THREE.Material[], materialIndex: number): boolean {
  if (!Array.isArray(material)) return material.visible;
  return material[materialIndex]?.visible ?? true;
}

function createCameraGizmo(host: HTMLElement, onDirectionSelected: (direction: THREE.Vector3) => void): CameraGizmo {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  const root = new THREE.Group();
  scene.add(root);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x172222, 2.4));

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
  keyLight.position.set(2.5, 3.5, 2);
  scene.add(keyLight);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pickables: Array<THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>> = [];
  let hovered: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null = null;

  const halfSize = 0.58;
  const faceGeometry = new THREE.PlaneGeometry(1.08, 1.08);
  const edgeThickness = 0.13;
  const edgeLength = 1.16;
  const cornerGeometry = new THREE.SphereGeometry(0.105, 18, 12);
  const faceColorByAxis = {
    x: 0xff7b73,
    y: 0x8bffb5,
    z: 0x7c95ff,
  };

  const faceDirections = [
    { label: "RIGHT", direction: new THREE.Vector3(1, 0, 0), color: faceColorByAxis.x },
    { label: "LEFT", direction: new THREE.Vector3(-1, 0, 0), color: faceColorByAxis.x },
    { label: "TOP", direction: new THREE.Vector3(0, 1, 0), color: faceColorByAxis.y },
    { label: "BOTTOM", direction: new THREE.Vector3(0, -1, 0), color: faceColorByAxis.y },
    { label: "BACK", direction: new THREE.Vector3(0, 0, 1), color: faceColorByAxis.z },
    { label: "FRONT", direction: new THREE.Vector3(0, 0, -1), color: faceColorByAxis.z },
  ];

  for (const face of faceDirections) {
    const material = createGizmoFaceMaterial(face.label, face.color);
    const mesh = new THREE.Mesh(faceGeometry, material);
    mesh.position.copy(face.direction).multiplyScalar(halfSize);
    orientObjectTowardDirection(mesh, face.direction);
    addGizmoPickable(root, pickables, mesh, face.direction);
  }

  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        const direction = new THREE.Vector3(x, y, z);
        const material = createGizmoHandleMaterial(0xf4fbff, 0.98);
        const corner = new THREE.Mesh(cornerGeometry, material);
        corner.position.set(x * halfSize, y * halfSize, z * halfSize);
        addGizmoPickable(root, pickables, corner, direction);
      }
    }
  }

  for (const axis of ["x", "y", "z"] as const) {
    const geometry =
      axis === "x"
        ? new THREE.BoxGeometry(edgeLength, edgeThickness, edgeThickness)
        : axis === "y"
          ? new THREE.BoxGeometry(edgeThickness, edgeLength, edgeThickness)
          : new THREE.BoxGeometry(edgeThickness, edgeThickness, edgeLength);

    for (const a of [-1, 1]) {
      for (const b of [-1, 1]) {
        const direction =
          axis === "x" ? new THREE.Vector3(0, a, b) : axis === "y" ? new THREE.Vector3(a, 0, b) : new THREE.Vector3(a, b, 0);
        const edge = new THREE.Mesh(geometry, createGizmoHandleMaterial(0x1b2b2d, 0.95));
        edge.position.set(
          axis === "x" ? 0 : a * halfSize,
          axis === "y" ? 0 : (axis === "x" ? a : b) * halfSize,
          axis === "z" ? 0 : b * halfSize,
        );
        addGizmoPickable(root, pickables, edge, direction);
      }
    }
  }

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.18, 1.18, 1.18)),
    new THREE.LineBasicMaterial({ color: 0xd7f5ff, transparent: true, opacity: 0.72 }),
  );
  root.add(outline);

  function setHovered(nextHovered: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null): void {
    if (hovered === nextHovered) return;
    if (hovered) applyGizmoHover(hovered, false);
    hovered = nextHovered;
    if (hovered) applyGizmoHover(hovered, true);
    host.classList.toggle("is-hovering", hovered !== null);
  }

  function pickGizmoObject(event: PointerEvent | MouseEvent): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1));
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0]?.object;
    return hit instanceof THREE.Mesh ? hit : null;
  }

  renderer.domElement.addEventListener("pointermove", (event) => {
    setHovered(pickGizmoObject(event));
  });

  renderer.domElement.addEventListener("pointerleave", () => {
    setHovered(null);
  });

  renderer.domElement.addEventListener("pointerdown", (event) => {
    event.preventDefault();
  });

  renderer.domElement.addEventListener("click", (event) => {
    const hit = pickGizmoObject(event);
    const direction = hit?.userData.cameraDirection;
    if (!(direction instanceof THREE.Vector3)) return;
    onDirectionSelected(direction);
  });

  function resize(): void {
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function render(viewCamera: THREE.Camera, viewTarget: THREE.Vector3): void {
    const viewDirection = viewCamera.position.clone().sub(viewTarget);
    if (viewDirection.lengthSq() < 0.001) viewDirection.set(1, 1, 1);
    camera.position.copy(viewDirection.normalize().multiplyScalar(4.2));
    lookAtWithStableVerticalUp(camera, new THREE.Vector3());
    renderer.render(scene, camera);
  }

  function dispose(): void {
    host.classList.remove("is-hovering");
    root.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        disposeGizmoMaterial(object.material);
      } else if (object instanceof THREE.Sprite) {
        disposeGizmoMaterial(object.material);
      }
    });
    renderer.dispose();
  }

  resize();

  return { render, resize, dispose };
}

function addGizmoPickable(
  root: THREE.Group,
  pickables: Array<THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>,
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>,
  direction: THREE.Vector3,
): void {
  mesh.userData.cameraDirection = direction.clone();
  mesh.userData.baseColor = mesh.material.color.clone();
  mesh.userData.baseOpacity = mesh.material.opacity;
  pickables.push(mesh);
  root.add(mesh);
}

function createGizmoHandleMaterial(color: THREE.ColorRepresentation, opacity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: 0x06100f,
    roughness: 0.52,
    metalness: 0.14,
    transparent: true,
    opacity,
  });
}

function createGizmoFaceMaterial(label: string, color: THREE.ColorRepresentation): THREE.MeshStandardMaterial {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const baseColor = new THREE.Color(color);
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(
    0,
    `rgba(${Math.round(baseColor.r * 255)}, ${Math.round(baseColor.g * 255)}, ${Math.round(baseColor.b * 255)}, 0.86)`,
  );
  gradient.addColorStop(1, "rgba(238, 255, 252, 0.72)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(255, 255, 255, 0.42)";
  context.lineWidth = 8;
  context.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
  context.fillStyle = "rgba(244, 251, 255, 0.92)";
  context.font = "800 38px ui-sans-serif, system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  return new THREE.MeshStandardMaterial({
    map: texture,
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0.08,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
  });
}

function applyGizmoHover(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>, hovered: boolean): void {
  const baseColor = mesh.userData.baseColor;
  const baseOpacity = mesh.userData.baseOpacity;
  if (baseColor instanceof THREE.Color) {
    mesh.material.color.copy(hovered ? new THREE.Color(0xffffff) : baseColor);
  }
  mesh.material.emissive.setHex(hovered ? 0x9bf0df : 0x06100f);
  mesh.material.opacity = hovered ? 1 : typeof baseOpacity === "number" ? baseOpacity : mesh.material.opacity;
}

function disposeGizmoMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    material.forEach(disposeGizmoMaterial);
    return;
  }
  const mappedMaterial = material as THREE.Material & { map?: THREE.Texture };
  mappedMaterial.map?.dispose();
  material.dispose();
}

function orientObjectTowardDirection(object: THREE.Object3D, direction: THREE.Vector3): void {
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.clone().normalize());
}

function cameraPositionForDirection(direction: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
  const normalized = direction.clone().normalize();
  const position = target.clone().add(normalized.multiplyScalar(CAMERA_VIEW_RADIUS));
  if (Math.abs(direction.y) < 0.001) {
    position.y = 1.65;
  }
  return position;
}

function angleForCameraDirection(direction: THREE.Vector3): AngleId | null {
  if (directionMatches(direction, new THREE.Vector3(0, 0, -1))) return "head-on";
  if (directionMatches(direction, new THREE.Vector3(1, 0, 0))) return "side";
  if (directionMatches(direction, new THREE.Vector3(0, 0, 1))) return "behind";
  if (directionMatches(direction, new THREE.Vector3(1, 1, -1))) return "isometric";
  return null;
}

function directionMatches(a: THREE.Vector3, b: THREE.Vector3): boolean {
  return a.clone().normalize().distanceTo(b.clone().normalize()) < 0.001;
}

function lookAtWithStableVerticalUp(camera: THREE.Camera, target: THREE.Vector3): void {
  const horizontalDistance = Math.hypot(camera.position.x - target.x, camera.position.z - target.z);
  if (horizontalDistance < 0.001) {
    camera.up.set(0, 0, camera.position.y >= target.y ? -1 : 1);
  } else {
    camera.up.set(0, 1, 0);
  }
  camera.lookAt(target);
}

function createInspectionFloor(): THREE.Group {
  const root = new THREE.Group();
  const grid = new THREE.GridHelper(5, 10, 0x2ddbd2, 0x263235);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(1.55, 64),
    new THREE.MeshStandardMaterial({
      color: 0x0b1113,
      roughness: 0.72,
      metalness: 0.4,
      transparent: true,
      opacity: 0.78,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(grid, floor);
  return root;
}

function createCollisionVolume(): {
  root: THREE.Group;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  cylinder: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
} {
  const root = new THREE.Group();
  root.name = "collision-volume-preview";

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.98, 1, 96),
    new THREE.MeshBasicMaterial({
      color: 0xffd166,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  ring.name = "collision-ground-circle";
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.012;

  const cylinder = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 1, 96, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xffd166,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  cylinder.name = "collision-cylinder";
  cylinder.renderOrder = 10;
  ring.renderOrder = 11;

  root.add(cylinder, ring);
  return { root, ring, cylinder };
}

function updateCollisionVolume(
  volume: {
    ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
    cylinder: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  },
  radius: number,
  height: number,
): void {
  volume.ring.scale.setScalar(radius);
  volume.cylinder.scale.set(radius, height, radius);
  volume.cylinder.position.y = height * 0.5;
}

function addAxisMarkers(scene: THREE.Scene): void {
  const front = new THREE.Mesh(
    new THREE.ConeGeometry(0.08, 0.28, 3),
    new THREE.MeshBasicMaterial({ color: 0x54f5ff }),
  );
  front.position.set(0, 0.08, -1.85);
  front.rotation.x = -Math.PI / 2;
  scene.add(front);

  const back = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.04, 0.16),
    new THREE.MeshBasicMaterial({ color: 0xff3f4f }),
  );
  back.position.set(0, 0.08, 1.85);
  scene.add(back);
}

function toAssetId(value: string | null | undefined): AssetId {
  return isAssetId(value) ? value : ASSETS[0].id;
}

function isAssetId(value: string | null | undefined): value is AssetId {
  return isEditorAssetId(value) && ASSETS.some((asset) => asset.id === value);
}

function isEditorAssetId(value: string | null | undefined): value is AssetId {
  return typeof value === "string" && value in EDITOR_ASSET_CREATORS;
}

function toAngleId(value: string | null | undefined): AngleId {
  return value === "head-on" || value === "side" || value === "behind" || value === "isometric"
    ? value
    : "isometric";
}

function toAnimationStateId(asset: AssetId, value: string | null | undefined): AnimationStateId {
  return ensureAnimationForAsset(asset, isAnimationStateId(value) ? value : "idle");
}

function ensureAnimationForAsset(asset: AssetId, animation: AnimationStateId): AnimationStateId {
  return animationOptions(asset).some((entry) => entry.id === animation) ? animation : "idle";
}

function animationOptions(asset: AssetId): Array<{ id: AnimationStateId; label: string }> {
  return ASSET_DEFINITIONS[asset].animations;
}

function syncAnimationOptions(select: HTMLSelectElement, state: AssetEditorState): void {
  const optionsMarkup = animationOptions(state.asset)
    .map((entry) => `<option value="${entry.id}" ${entry.id === state.animation ? "selected" : ""}>${entry.label}</option>`)
    .join("");
  if (select.innerHTML !== optionsMarkup) {
    select.innerHTML = optionsMarkup;
  }
}

function isAnimationStateId(value: string | null | undefined): value is AnimationStateId {
  return (
    value === "base-pose" ||
    value === "idle" ||
    value === "walk" ||
    value === "fire" ||
    value === "damaged" ||
    value === "low-health" ||
    value === "melee" ||
    value === "death"
  );
}

function isLeanHunterAnimationId(animation: AnimationStateId): animation is LeanHunterAnimationId {
  return animation === "idle" || animation === "walk" || animation === "melee" || animation === "death";
}

function toRenderModeId(value: string | null | undefined): RenderModeId {
  return value === "wireframe" || value === "bones" ? value : "shaded";
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function easeInOutCubic(value: number): number {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}
