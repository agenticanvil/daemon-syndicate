import * as THREE from "three";
import type { AssetSettings, EnemyAssetSettings, PickupAssetSettings, PlayerAssetSettings } from "./assetSettings";
import {
  ELITE_ENEMY_SETTINGS,
  createEliteEnemyAsset,
  type EliteEnemyAsset,
} from "./assets/enemies/eliteEnemy/eliteEnemyAsset";
import {
  LEAN_HUNTER_SETTINGS,
  loadLeanHunterRig,
  type LeanHunterAnimationId,
  type LeanHunterAnimationState,
  type LeanHunterRig,
} from "./assets/enemies/leanHunterAsset";
import {
  AMMO_PICKUP_SETTINGS,
  createAmmoPickupAsset,
  type AmmoPickupAsset,
} from "./assets/pickups/ammoPickup/ammoPickupAsset";
import {
  ENERGY_PICKUP_SETTINGS,
  createEnergyPickupAsset,
  type EnergyPickupAsset,
} from "./assets/pickups/energyPickup/energyPickupAsset";
import {
  HEALTH_PICKUP_SETTINGS,
  createHealthPickupAsset,
  type HealthPickupAsset,
} from "./assets/pickups/healthPickup/healthPickupAsset";
import playerSettings from "./assets/player/player.settings.json";
import { loadPlayerRig, type PlayerAnimationState } from "./playerAsset";

type AssetId = "player" | "lean-hunter" | "elite-enemy" | "health-pickup" | "ammo-pickup" | "energy-pickup";
type AngleId = "head-on" | "side" | "behind" | "isometric";
type PlayerAnimationStateId = "idle" | "walk" | "fire" | "damaged" | "low-health";
type AnimationStateId = PlayerAnimationStateId | LeanHunterAnimationId;
type RenderModeId = "shaded" | "wireframe";

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

const PLAYER_SETTINGS = playerSettings as PlayerAssetSettings;

const ASSET_DEFINITIONS = {
  player: {
    label: "Player",
    targetY: 1.05,
    collision: PLAYER_SETTINGS.collision,
    animations: [
      { id: "idle", label: "Idle" },
      { id: "walk", label: "Walk" },
      { id: "fire", label: "Fire" },
      { id: "damaged", label: "Damaged" },
      { id: "low-health", label: "Low Health" },
    ],
  },
  "lean-hunter": {
    label: "Lean Hunter",
    targetY: 0.42,
    collision: LEAN_HUNTER_SETTINGS.collision,
    animations: [
      { id: "idle", label: "Idle" },
      { id: "walk", label: "Walk" },
      { id: "melee", label: "Melee" },
      { id: "death", label: "Death" },
    ],
  },
  "elite-enemy": {
    label: "Elite Hunter",
    targetY: 0.42,
    collision: ELITE_ENEMY_SETTINGS.collision,
    animations: [
      { id: "idle", label: "Idle" },
      { id: "walk", label: "Walk" },
      { id: "melee", label: "Melee" },
      { id: "death", label: "Death" },
    ],
  },
  "health-pickup": {
    label: "Health Pickup",
    targetY: 0.45,
    collision: HEALTH_PICKUP_SETTINGS.collision,
    animations: [{ id: "idle", label: "Idle" }],
  },
  "ammo-pickup": {
    label: "Ammo Pickup",
    targetY: 0.45,
    collision: AMMO_PICKUP_SETTINGS.collision,
    animations: [{ id: "idle", label: "Idle" }],
  },
  "energy-pickup": {
    label: "Energy Pickup",
    targetY: 0.45,
    collision: ENERGY_PICKUP_SETTINGS.collision,
    animations: [{ id: "idle", label: "Idle" }],
  },
} satisfies Record<AssetId, AssetDefinition>;

const ASSETS: Array<{ id: AssetId; label: string }> = [
  { id: "player", label: ASSET_DEFINITIONS.player.label },
  { id: "lean-hunter", label: ASSET_DEFINITIONS["lean-hunter"].label },
  { id: "elite-enemy", label: ASSET_DEFINITIONS["elite-enemy"].label },
  { id: "health-pickup", label: ASSET_DEFINITIONS["health-pickup"].label },
  { id: "ammo-pickup", label: ASSET_DEFINITIONS["ammo-pickup"].label },
  { id: "energy-pickup", label: ASSET_DEFINITIONS["energy-pickup"].label },
];
const STANDARD_CAMERA_DISTANCE = 1;
const CAMERA_DISTANCE_STEP = 0.15;
const CAMERA_DISTANCE_MIN = 0.65;
const CAMERA_DISTANCE_MAX = 1.6;
const COLLISION_RADIUS_MIN = 0.1;
const COLLISION_RADIUS_MAX = 1.4;
const HEALTH_MIN = 1;
const HEALTH_MAX = 999;
const ASSET_SPEED_MIN = 0;
const ASSET_SPEED_MAX = 8;
const ASSET_SETTINGS_ENDPOINTS = {
  player: "/__dev/asset-settings/player",
  "lean-hunter": "/__dev/asset-settings/lean-hunter",
  "elite-enemy": "/__dev/asset-settings/elite-enemy",
  "health-pickup": "/__dev/asset-settings/health-pickup",
  "ammo-pickup": "/__dev/asset-settings/ammo-pickup",
  "energy-pickup": "/__dev/asset-settings/energy-pickup",
} satisfies Record<AssetId, string>;

const CAMERA_POSES: Record<AngleId, CameraPose> = {
  "head-on": { label: "Head On", position: [0, 1.65, -5.2] },
  side: { label: "Side", position: [5.2, 1.65, 0] },
  behind: { label: "Behind", position: [0, 1.65, 5.2] },
  isometric: { label: "Isometric", position: [4.2, 4.2, -4.2] },
};

const RENDER_MODES: Array<{ id: RenderModeId; label: string }> = [
  { id: "shaded", label: "Shaded" },
  { id: "wireframe", label: "Wireframe" },
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
  const assetSettingsSaveButton = app.querySelector<HTMLButtonElement>("#assetSettingsSaveButton")!;
  const assetSettingsStatus = app.querySelector<HTMLElement>("#assetSettingsStatus")!;
  const renderCalls = app.querySelector<HTMLElement>("#renderCalls")!;
  const triangleCount = app.querySelector<HTMLElement>("#triangleCount")!;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  canvasHost.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05080a);
  scene.fog = new THREE.Fog(0x05080a, 12, 24);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  const target = new THREE.Vector3(0, ASSET_DEFINITIONS[state.asset].targetY, 0);
  const loader = new THREE.TextureLoader();
  const rigs = {
    player: loadPlayerRig(loader, renderer.capabilities.getMaxAnisotropy()),
    "lean-hunter": loadLeanHunterRig(loader, renderer.capabilities.getMaxAnisotropy()),
    "elite-enemy": createEliteEnemyAsset(loader, renderer.capabilities.getMaxAnisotropy()),
    "health-pickup": createHealthPickupAsset(),
    "ammo-pickup": createAmmoPickupAsset(),
    "energy-pickup": createEnergyPickupAsset(),
  };
  scene.add(...ASSETS.map((asset) => rigs[asset.id].root));

  const floor = createInspectionFloor();
  scene.add(floor);
  const collisionVolume = createCollisionVolume();
  scene.add(collisionVolume.root);
  addInspectionLights(scene);
  addAxisMarkers(scene);

  const clock = new THREE.Clock();
  let disposed = false;
  let firePulseTimer = 0;
  let dragStart: { x: number; angle: number } | null = null;
  let customOrbitAngle = 0;
  let customOrbitRadius = 5.2;
  let usingCustomOrbit = false;

  function activeRig(): typeof rigs.player | LeanHunterRig | EliteEnemyAsset | HealthPickupAsset | AmmoPickupAsset | EnergyPickupAsset {
    return rigs[state.asset];
  }

  function applyActiveAsset(): void {
    target.y = ASSET_DEFINITIONS[state.asset].targetY;
    for (const asset of ASSETS) {
      rigs[asset.id].root.visible = state.asset === asset.id;
    }
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
    cameraResetButton.disabled = state.cameraDistance === STANDARD_CAMERA_DISTANCE && !usingCustomOrbit;
    cameraAwayButton.disabled = state.cameraDistance >= CAMERA_DISTANCE_MAX;
    collisionToggle.checked = state.collisionVisible;
    assetCollisionRadiusInput.value = settings.collision.radius.toFixed(2);
    assetHealthField.hidden = !hasHealth(settings);
    if (hasHealth(settings)) {
      assetHealthInput.value = settings.health.toString();
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
    assetSettingsSaveButton.disabled = false;

    for (const button of app.querySelectorAll<HTMLButtonElement>("[data-angle]")) {
      button.classList.toggle("selected", button.dataset.angle === state.angle && !usingCustomOrbit);
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
    applyStateToControls();
    syncUrl();
  }

  function moveCameraDistance(delta: number): void {
    state.cameraDistance = clamp(
      Number((state.cameraDistance + delta).toFixed(2)),
      CAMERA_DISTANCE_MIN,
      CAMERA_DISTANCE_MAX,
    );
    applyStateToControls();
    syncUrl();
  }

  function resetCameraPosition(): void {
    state.cameraDistance = STANDARD_CAMERA_DISTANCE;
    usingCustomOrbit = false;
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
    settings.health = Math.round(clamp(health, HEALTH_MIN, HEALTH_MAX));
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
      setWireframe(rigs[asset.id].root, state.renderMode === "wireframe");
    }
  }

  function updateCamera(): void {
    const cameraPosition = new THREE.Vector3();
    if (usingCustomOrbit) {
      cameraPosition.set(
        Math.sin(customOrbitAngle) * customOrbitRadius,
        state.angle === "isometric" ? 4.2 : 1.65,
        Math.cos(customOrbitAngle) * customOrbitRadius,
      );
    } else {
      cameraPosition.fromArray(CAMERA_POSES[state.angle].position);
    }
    camera.position.copy(target).add(cameraPosition.sub(target).multiplyScalar(state.cameraDistance));
    camera.lookAt(target);
  }

  function resize(): void {
    const width = Math.max(canvasHost.clientWidth, 1);
    const height = Math.max(canvasHost.clientHeight, 1);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function playerAnimationState(dt: number): PlayerAnimationState {
    const moving = state.animation === "walk";
    const damaged = state.animation === "damaged";
    const lowHealth = state.animation === "low-health";

    if (state.animation === "fire" && state.playing) {
      firePulseTimer -= dt;
      if (firePulseTimer <= 0) {
        rigs.player.triggerFire();
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
    updateCamera();
    if (state.asset === "player") {
      rigs.player.update(playerAnimationState(dt), dt);
    } else if (state.asset === "lean-hunter" || state.asset === "elite-enemy") {
      rigs["lean-hunter"].update(leanHunterAnimationState(), dt);
      rigs["elite-enemy"].update(leanHunterAnimationState(), dt);
    }
    renderer.render(scene, camera);
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
    if (state.asset === "player" && state.animation === "fire") rigs.player.triggerFire();
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

  assetSettingsSaveButton.addEventListener("click", () => {
    void saveActiveAssetSettings();
  });

  renderer.domElement.addEventListener("pointerdown", (event) => {
    renderer.domElement.setPointerCapture(event.pointerId);
    const pose = usingCustomOrbit ? null : CAMERA_POSES[state.angle].position;
    if (pose) {
      customOrbitAngle = Math.atan2(pose[0], pose[2]);
      customOrbitRadius = Math.hypot(pose[0], pose[2]);
    }
    dragStart = { x: event.clientX, angle: customOrbitAngle };
  });

  renderer.domElement.addEventListener("pointermove", (event) => {
    if (!dragStart) return;
    usingCustomOrbit = true;
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
    renderer.dispose();
  });

  applyActiveAsset();
  applyCollisionVolume();
  applyStateToControls();
  applyRenderMode();
  resize();
  if (state.asset === "player" && state.animation === "fire") rigs.player.triggerFire();
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
  return {
    player: cloneAssetSettings({
      kind: "player",
      collision: PLAYER_SETTINGS.collision,
      health: PLAYER_SETTINGS.health,
      movement: PLAYER_SETTINGS.movement,
    }),
    "lean-hunter": cloneAssetSettings(LEAN_HUNTER_SETTINGS),
    "elite-enemy": cloneAssetSettings(ELITE_ENEMY_SETTINGS),
    "health-pickup": cloneAssetSettings(HEALTH_PICKUP_SETTINGS),
    "ammo-pickup": cloneAssetSettings(AMMO_PICKUP_SETTINGS),
    "energy-pickup": cloneAssetSettings(ENERGY_PICKUP_SETTINGS),
  };
}

function cloneAssetSettings<T extends AssetSettings>(settings: T): T {
  return structuredClone(settings);
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
  return hasHealth(settings) ? settings.health : 0;
}

function assetSpeedValue(settings: AssetSettings): number {
  return hasMovementSpeed(settings) ? getMovementSpeed(settings) : 0;
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

function addInspectionLights(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight(0xc9fbff, 0x0b1510, 1.85));

  const keyLight = new THREE.DirectionalLight(0xf4fffb, 4.4);
  keyLight.position.set(-3.4, 4.8, -4.2);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  scene.add(keyLight);

  const frontFill = new THREE.PointLight(0xbdfcff, 18, 8);
  frontFill.position.set(-1.8, 2.3, -3.2);
  scene.add(frontFill);

  const rimLight = new THREE.DirectionalLight(0x67ddff, 1.5);
  rimLight.position.set(4, 3, 4);
  scene.add(rimLight);
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
  return isAssetId(value) ? value : "player";
}

function isAssetId(value: string | null | undefined): value is AssetId {
  return (
    value === "player" ||
    value === "lean-hunter" ||
    value === "elite-enemy" ||
    value === "health-pickup" ||
    value === "ammo-pickup" ||
    value === "energy-pickup"
  );
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
  return value === "wireframe" ? value : "shaded";
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
