import * as THREE from "three";
import { loadPlayerRig, type PlayerAnimationState } from "./playerAsset";

type AssetId = "player";
type AngleId = "head-on" | "side" | "behind" | "isometric";
type AnimationStateId = "idle" | "walk" | "fire" | "damaged" | "low-health";

type AssetRendererState = {
  asset: AssetId;
  angle: AngleId;
  animation: AnimationStateId;
  cameraDistance: number;
  speed: number;
  playing: boolean;
};

type CameraPose = {
  label: string;
  position: [number, number, number];
};

const ASSETS: Array<{ id: AssetId; label: string }> = [{ id: "player", label: "Player" }];
const STANDARD_CAMERA_DISTANCE = 1;
const CAMERA_DISTANCE_STEP = 0.15;
const CAMERA_DISTANCE_MIN = 0.65;
const CAMERA_DISTANCE_MAX = 1.6;

const CAMERA_POSES: Record<AngleId, CameraPose> = {
  "head-on": { label: "Head On", position: [0, 1.65, -5.2] },
  side: { label: "Side", position: [5.2, 1.65, 0] },
  behind: { label: "Behind", position: [0, 1.65, 5.2] },
  isometric: { label: "Isometric", position: [4.2, 4.2, -4.2] },
};

const ANIMATION_STATES: Array<{ id: AnimationStateId; label: string }> = [
  { id: "idle", label: "Idle" },
  { id: "walk", label: "Walk" },
  { id: "fire", label: "Fire" },
  { id: "damaged", label: "Damaged" },
  { id: "low-health", label: "Low Health" },
];

export function startAssetRenderer(app: HTMLDivElement): void {
  const state = readStateFromUrl();
  app.className = "asset-renderer";
  app.innerHTML = createAssetRendererMarkup(state);

  const canvasHost = app.querySelector<HTMLDivElement>("#assetRendererCanvas")!;
  const assetSelect = app.querySelector<HTMLSelectElement>("#assetSelect")!;
  const animationSelect = app.querySelector<HTMLSelectElement>("#animationSelect")!;
  const playToggle = app.querySelector<HTMLInputElement>("#playToggle")!;
  const speedInput = app.querySelector<HTMLInputElement>("#speedInput")!;
  const speedValue = app.querySelector<HTMLElement>("#speedValue")!;
  const cameraCloserButton = app.querySelector<HTMLButtonElement>("#cameraCloserButton")!;
  const cameraResetButton = app.querySelector<HTMLButtonElement>("#cameraResetButton")!;
  const cameraAwayButton = app.querySelector<HTMLButtonElement>("#cameraAwayButton")!;
  const cameraDistanceValue = app.querySelector<HTMLElement>("#cameraDistanceValue")!;
  const renderCalls = app.querySelector<HTMLElement>("#renderCalls")!;
  const triangleCount = app.querySelector<HTMLElement>("#triangleCount")!;
  const cameraLabel = app.querySelector<HTMLElement>("#cameraLabel")!;
  const assetName = app.querySelector<HTMLElement>("#assetName")!;
  const stateName = app.querySelector<HTMLElement>("#stateName")!;

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
  const target = new THREE.Vector3(0, 1.05, 0);
  const loader = new THREE.TextureLoader();
  const rig = loadPlayerRig(loader, renderer.capabilities.getMaxAnisotropy());
  scene.add(rig.root);

  const floor = createInspectionFloor();
  scene.add(floor);
  addInspectionLights(scene);
  addAxisMarkers(scene);

  const clock = new THREE.Clock();
  let disposed = false;
  let firePulseTimer = 0;
  let dragStart: { x: number; angle: number } | null = null;
  let customOrbitAngle = 0;
  let customOrbitRadius = 5.2;
  let usingCustomOrbit = false;

  function applyStateToControls(): void {
    assetSelect.value = state.asset;
    animationSelect.value = state.animation;
    playToggle.checked = state.playing;
    speedInput.value = state.speed.toString();
    speedValue.textContent = `${state.speed.toFixed(1)}x`;
    cameraDistanceValue.textContent = `${state.cameraDistance.toFixed(2)}x`;
    cameraCloserButton.disabled = state.cameraDistance <= CAMERA_DISTANCE_MIN;
    cameraResetButton.disabled = state.cameraDistance === STANDARD_CAMERA_DISTANCE && !usingCustomOrbit;
    cameraAwayButton.disabled = state.cameraDistance >= CAMERA_DISTANCE_MAX;

    for (const button of app.querySelectorAll<HTMLButtonElement>("[data-angle]")) {
      button.classList.toggle("selected", button.dataset.angle === state.angle && !usingCustomOrbit);
    }

    assetName.textContent = ASSETS.find((asset) => asset.id === state.asset)?.label ?? state.asset;
    stateName.textContent = ANIMATION_STATES.find((entry) => entry.id === state.animation)?.label ?? state.animation;
    cameraLabel.textContent = `${usingCustomOrbit ? "Custom" : CAMERA_POSES[state.angle].label} ${state.cameraDistance.toFixed(
      2,
    )}x`;
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

  function animationState(dt: number): PlayerAnimationState {
    const moving = state.animation === "walk";
    const damaged = state.animation === "damaged";
    const lowHealth = state.animation === "low-health";

    if (state.animation === "fire" && state.playing) {
      firePulseTimer -= dt;
      if (firePulseTimer <= 0) {
        rig.triggerFire();
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

  function animate(): void {
    if (disposed) return;
    requestAnimationFrame(animate);

    const rawDt = Math.min(clock.getDelta(), 0.033);
    const dt = state.playing ? rawDt * state.speed : 0;
    updateCamera();
    rig.update(animationState(dt), dt);
    renderer.render(scene, camera);
    renderCalls.textContent = renderer.info.render.calls.toString();
    triangleCount.textContent = renderer.info.render.triangles.toLocaleString();
  }

  for (const button of app.querySelectorAll<HTMLButtonElement>("[data-angle]")) {
    button.addEventListener("click", () => setAngle(toAngleId(button.dataset.angle)));
  }

  cameraCloserButton.addEventListener("click", () => moveCameraDistance(-CAMERA_DISTANCE_STEP));
  cameraResetButton.addEventListener("click", resetCameraPosition);
  cameraAwayButton.addEventListener("click", () => moveCameraDistance(CAMERA_DISTANCE_STEP));

  assetSelect.addEventListener("change", () => {
    state.asset = toAssetId(assetSelect.value);
    applyStateToControls();
    syncUrl();
  });

  animationSelect.addEventListener("change", () => {
    state.animation = toAnimationStateId(animationSelect.value);
    firePulseTimer = 0;
    if (state.animation === "fire") rig.triggerFire();
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

  applyStateToControls();
  resize();
  if (state.animation === "fire") rig.triggerFire();
  animate();
}

function createAssetRendererMarkup(state: AssetRendererState): string {
  const angleButtons = Object.entries(CAMERA_POSES)
    .map(
      ([id, pose]) =>
        `<button type="button" data-angle="${id}" class="${id === state.angle ? "selected" : ""}">${pose.label}</button>`,
    )
    .join("");

  const assetOptions = ASSETS.map(
    (asset) => `<option value="${asset.id}" ${asset.id === state.asset ? "selected" : ""}>${asset.label}</option>`,
  ).join("");

  const stateOptions = ANIMATION_STATES.map(
    (entry) =>
      `<option value="${entry.id}" ${entry.id === state.animation ? "selected" : ""}>${entry.label}</option>`,
  ).join("");

  return `
    <main class="asset-renderer-shell">
      <section class="asset-renderer-stage" aria-label="Asset preview">
        <div id="assetRendererCanvas" class="asset-renderer-canvas"></div>
        <div class="asset-renderer-readout">
          <div><span>Asset</span><strong id="assetName"></strong></div>
          <div><span>State</span><strong id="stateName"></strong></div>
          <div><span>Camera</span><strong id="cameraLabel"></strong></div>
        </div>
      </section>
      <aside class="asset-renderer-panel" aria-label="Asset renderer controls">
        <div class="asset-renderer-title">
          <p>Dev Tool</p>
          <h1>Asset Renderer</h1>
        </div>
        <label>
          <span>Asset</span>
          <select id="assetSelect">${assetOptions}</select>
        </label>
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
        <label class="toggle-row">
          <span>Playback</span>
          <input id="playToggle" type="checkbox" ${state.playing ? "checked" : ""} />
        </label>
        <label>
          <span>Speed <strong id="speedValue">${state.speed.toFixed(1)}x</strong></span>
          <input id="speedInput" type="range" min="0.1" max="2.5" step="0.1" value="${state.speed}" />
        </label>
        <div class="asset-renderer-metrics">
          <div><span>Render Calls</span><strong id="renderCalls">0</strong></div>
          <div><span>Triangles</span><strong id="triangleCount">0</strong></div>
        </div>
        <a href="/" class="asset-renderer-link">Back to Game</a>
      </aside>
    </main>
  `;
}

function readStateFromUrl(): AssetRendererState {
  const params = new URLSearchParams(window.location.search);
  return {
    asset: toAssetId(params.get("asset")),
    angle: toAngleId(params.get("angle")),
    animation: toAnimationStateId(params.get("state") ?? params.get("animation")),
    cameraDistance: clamp(Number(params.get("distance") ?? STANDARD_CAMERA_DISTANCE), CAMERA_DISTANCE_MIN, CAMERA_DISTANCE_MAX),
    speed: clamp(Number(params.get("speed") ?? "1"), 0.1, 2.5),
    playing: params.get("paused") !== "1",
  };
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
  return value === "player" ? value : "player";
}

function toAngleId(value: string | null | undefined): AngleId {
  return value === "head-on" || value === "side" || value === "behind" || value === "isometric"
    ? value
    : "isometric";
}

function toAnimationStateId(value: string | null | undefined): AnimationStateId {
  return value === "idle" ||
    value === "walk" ||
    value === "fire" ||
    value === "damaged" ||
    value === "low-health"
    ? value
    : "idle";
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
