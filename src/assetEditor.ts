import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { EnemyAttackDefinition, PickupAssetSettings } from "./assetSettings";
import type { AssetSidecar, EditorAssetRecord } from "./assetManifest";
import { createRenderer } from "./renderer";
import { addGameplayLighting } from "./sceneLighting";
import type { ResourceKind } from "./resourceTypes";

type EnemySidecar = Extract<AssetSidecar, { kind: "enemy" }>;
type PlayerSidecar = Extract<AssetSidecar, { kind: "player" }>;
type AngleId = "head-on" | "side" | "behind" | "isometric";
type RenderModeId = "shaded" | "wireframe" | "bones";
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
type LoadedModel = {
  record: EditorAssetRecord;
  root: THREE.Group;
  clips: THREE.AnimationClip[];
  mixer: THREE.AnimationMixer | null;
  activeAction: THREE.AnimationAction | null;
  boneHelper: THREE.SkeletonHelper | null;
};
type AssetEditorState = {
  assetKey: string;
  angle: AngleId;
  animation: string;
  cameraDistance: number;
  speed: number;
  playing: boolean;
  renderMode: RenderModeId;
  collisionVisible: boolean;
  collisionEditMode: boolean;
  assetSettings: Record<string, AssetSidecar>;
};
type CollisionPreview = {
  root: THREE.Group;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  handle: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
};

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
  void startAssetEditorAsync(app);
}

async function startAssetEditorAsync(app: HTMLDivElement): Promise<void> {
  app.className = "asset-editor";
  app.innerHTML = createLoadingMarkup();

  let records: EditorAssetRecord[];
  try {
    records = await loadAssetRecords();
  } catch (error) {
    app.innerHTML = createEmptyMarkup(error instanceof Error ? error.message : "Failed to load assets");
    return;
  }

  if (records.length === 0) {
    app.innerHTML = createEmptyMarkup("No GLB assets found in public/assets or public/assets/_staged.");
    return;
  }

  const state = readStateFromUrl(records);
  app.innerHTML = createAssetEditorMarkup(state, records);

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
  const collisionEditToggle = app.querySelector<HTMLInputElement>("#collisionEditToggle")!;
  const assetCollisionRadiusInput = app.querySelector<HTMLInputElement>("#assetCollisionRadiusInput")!;
  const assetHealthField = app.querySelector<HTMLElement>("#assetHealthField")!;
  const assetHealthInput = app.querySelector<HTMLInputElement>("#assetHealthInput")!;
  const assetSpeedField = app.querySelector<HTMLElement>("#assetSpeedField")!;
  const assetSpeedLabel = app.querySelector<HTMLElement>("#assetSpeedLabel")!;
  const assetSpeedInput = app.querySelector<HTMLInputElement>("#assetSpeedInput")!;
  const pickupResourcesField = app.querySelector<HTMLElement>("#pickupResourcesField")!;
  const pickupResourcesInputs = Array.from(app.querySelectorAll<HTMLInputElement>("[data-pickup-resource]"));
  const enemyGameplayField = app.querySelector<HTMLElement>("#enemyGameplayField")!;
  const enemyGameplayInputs = Array.from(app.querySelectorAll<HTMLInputElement>("[data-enemy-gameplay-field]"));
  const enemyCombatField = app.querySelector<HTMLElement>("#enemyCombatField")!;
  const enemyAttackInputs = Array.from(app.querySelectorAll<HTMLInputElement>("[data-enemy-attack-field]"));
  const enemySpawnWeightInputs = Array.from(app.querySelectorAll<HTMLInputElement>("[data-enemy-spawn-field]"));
  const enemyDropChanceInput = app.querySelector<HTMLInputElement>("#enemyDropChanceInput")!;
  const enemyDropEntryInputs = Array.from(app.querySelectorAll<HTMLInputElement>("[data-enemy-drop-kind]"));
  const rawJson = app.querySelector<HTMLTextAreaElement>("#rawJson")!;
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
  const target = new THREE.Vector3(0, activeSidecar().preview?.targetY ?? 0.6, 0);
  const cameraGizmo = createCameraGizmo(gizmoHost, setCameraDirection);
  const gltfLoader = new GLTFLoader();
  const floor = createInspectionFloor();
  const collisionPreview = createCollisionPreview();
  const lightAnchor = new THREE.Group();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const dragPoint = new THREE.Vector3();

  scene.add(floor, collisionPreview.root, lightAnchor);
  addGameplayLighting(scene, lightAnchor);
  addAxisMarkers(scene);

  const clock = new THREE.Clock();
  let disposed = false;
  let loadedModel: LoadedModel | null = null;
  let loadToken = 0;
  let dragStart: { x: number; angle: number } | null = null;
  let collisionDragPointerId: number | null = null;
  let customOrbitAngle = 0;
  let customOrbitRadius = 5.2;
  let usingCustomOrbit = false;
  let customCameraDirection: THREE.Vector3 | null = null;
  let cameraTransition: CameraTransition | null = null;

  function activeRecord(): EditorAssetRecord {
    return records.find((record) => assetKey(record) === state.assetKey) ?? records[0];
  }

  function activeSidecar(): AssetSidecar {
    return state.assetSettings[state.assetKey] ?? activeRecord().sidecar;
  }

  async function applyActiveAsset(): Promise<void> {
    const token = ++loadToken;
    const record = activeRecord();
    target.y = activeSidecar().preview?.targetY ?? 0.6;
    setAssetSettingsStatus("Loading model...");
    disposeLoadedModel();

    try {
      const gltf = await loadGltf(gltfLoader, record.modelUrl);
      if (disposed || token !== loadToken) {
        disposeGltf(gltf);
        return;
      }
      loadedModel = createLoadedModel(record, gltf);
      scene.add(loadedModel.root);
      applyRenderMode();
      syncAnimationOptions(animationSelect, state, loadedModel);
      state.animation = ensureAnimationForLoadedModel(state.animation, loadedModel);
      applyAnimationSelection();
      applyCollisionPreview();
      setAssetSettingsStatus(record.sidecarExists ? "Loaded sidecar" : "Loaded defaults");
    } catch (error) {
      setAssetSettingsStatus(error instanceof Error ? error.message : "Failed to load model");
    }

    applyStateToControls();
  }

  function createLoadedModel(record: EditorAssetRecord, gltf: GLTF): LoadedModel {
    const root = gltf.scene;
    const sidecar = activeSidecar();
    root.name = `${record.category}/${record.name}`;
    root.scale.setScalar(sidecar.model.scale ?? 1);
    root.rotation.y = sidecar.model.rotationY ?? 0;
    root.position.y = sidecar.model.floorOffset ?? 0;
    applyGameMaterialConventions(root);

    const mixer = gltf.animations.length > 0 ? new THREE.AnimationMixer(root) : null;
    const boneHelper = hasSkinnedMeshes(root) ? createBoneHelper(root) : null;
    if (boneHelper) scene.add(boneHelper);
    return { record, root, clips: gltf.animations, mixer, activeAction: null, boneHelper };
  }

  function disposeLoadedModel(): void {
    if (!loadedModel) return;
    scene.remove(loadedModel.root);
    if (loadedModel.boneHelper) scene.remove(loadedModel.boneHelper);
    disposeObject3D(loadedModel.root);
    loadedModel.boneHelper?.geometry.dispose();
    disposeMaterial(loadedModel.boneHelper?.material);
    loadedModel.mixer?.stopAllAction();
    loadedModel = null;
  }

  function applyStateToControls(): void {
    const settings = activeSidecar();
    assetSelect.value = state.assetKey;
    syncAnimationOptions(animationSelect, state, loadedModel);
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
    collisionEditToggle.checked = state.collisionEditMode;
    assetCollisionRadiusInput.value = settings.collision.radius.toFixed(2);
    assetHealthField.hidden = !hasHealth(settings);
    if (hasHealth(settings)) assetHealthInput.value = assetHealthValue(settings).toString();
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
    enemyGameplayField.hidden = settings.kind !== "enemy";
    enemyCombatField.hidden = settings.kind !== "enemy";
    if (settings.kind === "enemy") {
      syncEnemyGameplayInputs(settings);
      const attack = primaryEditableAttack(settings);
      enemyAttackInputs.forEach((input) => {
        input.value = enemyAttackInputValue(attack, input.dataset.enemyAttackField).toString();
      });
      enemySpawnWeightInputs.forEach((input) => {
        input.value = enemySpawnInputValue(settings, input.dataset.enemySpawnField);
      });
      enemyDropChanceInput.value = settings.dropTable.chance.toFixed(3);
      enemyDropEntryInputs.forEach((input) => {
        const entry = enemyDropEntry(settings, toResourceKind(input.dataset.enemyDropKind));
        const field = input.dataset.enemyDropField;
        input.value = String(field === "amount" ? entry.amount : entry.weight);
      });
    }
    rawJson.value = JSON.stringify(settings, null, 2);

    const usingCustomCamera = usingCustomOrbit || customCameraDirection !== null;
    for (const button of app.querySelectorAll<HTMLButtonElement>("[data-angle]")) {
      button.classList.toggle("selected", button.dataset.angle === state.angle && !usingCustomCamera);
    }
    for (const button of app.querySelectorAll<HTMLButtonElement>("[data-render-mode]")) {
      button.classList.toggle("selected", button.dataset.renderMode === state.renderMode);
    }
  }

  function syncEnemyGameplayInputs(settings: EnemySidecar): void {
    enemyGameplayInputs.forEach((input) => {
      const field = input.dataset.enemyGameplayField;
      if (field === "unlockMapDepth") input.value = settings.gameplay.unlockMapDepth.toString();
      if (field === "budgetCost") input.value = settings.gameplay.budgetCost.toString();
      if (field === "attackDamageLevelGrowth") input.value = settings.gameplay.attackDamageLevelGrowth.toString();
      if (field === "xpReward.base") input.value = settings.gameplay.xpReward.base.toString();
      if (field === "xpReward.levelGrowth") input.value = settings.gameplay.xpReward.levelGrowth.toString();
    });
  }

  function syncUrl(): void {
    const record = activeRecord();
    const params = new URLSearchParams();
    params.set("asset", `${record.category}/${record.name}`);
    params.set("angle", state.angle);
    params.set("state", state.animation);
    params.set("speed", state.speed.toFixed(1));
    if (record.staged) params.set("staged", "1");
    if (state.cameraDistance !== STANDARD_CAMERA_DISTANCE) params.set("distance", state.cameraDistance.toFixed(2));
    if (state.renderMode !== "shaded") params.set("mode", state.renderMode);
    if (!state.collisionVisible) params.set("hideCollision", "1");
    if (state.collisionEditMode) params.set("editCollision", "1");
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
    state.cameraDistance = clamp(Number((state.cameraDistance + delta).toFixed(2)), CAMERA_DISTANCE_MIN, CAMERA_DISTANCE_MAX);
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

  function setAssetCollisionRadius(radius: number): void {
    activeSidecar().collision.radius = clamp(radius, COLLISION_RADIUS_MIN, COLLISION_RADIUS_MAX);
    applyCollisionPreview();
    applyStateToControls();
    setAssetSettingsStatus("Unsaved changes");
  }

  function setAssetHealth(health: number): void {
    const settings = activeSidecar();
    if (!hasHealth(settings)) return;
    if (settings.kind === "enemy") settings.health.base = Math.round(clamp(health, HEALTH_MIN, HEALTH_MAX));
    else settings.health = Math.round(clamp(health, HEALTH_MIN, HEALTH_MAX));
    applyStateToControls();
    setAssetSettingsStatus("Unsaved changes");
  }

  function setAssetSpeed(speed: number): void {
    const settings = activeSidecar();
    if (!hasMovementSpeed(settings)) return;
    setMovementSpeed(settings, clamp(speed, ASSET_SPEED_MIN, ASSET_SPEED_MAX));
    applyStateToControls();
    setAssetSettingsStatus("Unsaved changes");
  }

  function setPickupResource(kind: keyof PickupAssetSettings["resources"], amount: number): void {
    const settings = activeSidecar();
    if (settings.kind !== "pickup") return;
    settings.resources[kind] = Math.round(clamp(amount, 0, HEALTH_MAX));
    applyStateToControls();
    setAssetSettingsStatus("Unsaved changes");
  }

  function setEnemyGameplayField(field: string | undefined, value: number): void {
    const settings = activeSidecar();
    if (settings.kind !== "enemy") return;
    if (field === "unlockMapDepth") settings.gameplay.unlockMapDepth = Math.round(clamp(value, 1, 99));
    else if (field === "budgetCost") settings.gameplay.budgetCost = clamp(value, 0.01, 99);
    else if (field === "attackDamageLevelGrowth") settings.gameplay.attackDamageLevelGrowth = clamp(value, 0, 99);
    else if (field === "xpReward.base") settings.gameplay.xpReward.base = clamp(value, 0, 999);
    else if (field === "xpReward.levelGrowth") settings.gameplay.xpReward.levelGrowth = clamp(value, 0, 999);
    else return;
    applyStateToControls();
    setAssetSettingsStatus("Unsaved changes");
  }

  function setEnemySpawnField(field: string | undefined, value: number): void {
    const settings = activeSidecar();
    if (settings.kind !== "enemy") return;
    if (field === "base") settings.spawnWeight.base = clamp(value, 0.001, 10);
    else if (field === "levelGrowth") settings.spawnWeight.levelGrowth = clamp(value, -10, 10);
    else if (field === "min") settings.spawnWeight.min = Number.isFinite(value) ? clamp(value, 0, 10) : undefined;
    else if (field === "max") settings.spawnWeight.max = Number.isFinite(value) ? clamp(value, 0.001, 10) : undefined;
    else return;
    applyStateToControls();
    setAssetSettingsStatus("Unsaved changes");
  }

  function setEnemyAttackField(field: string | undefined, value: number): void {
    const settings = activeSidecar();
    if (settings.kind !== "enemy") return;
    const attack = primaryEditableAttack(settings);
    if (field === "damage") attack.damage = Math.round(clamp(value, 1, ENEMY_ATTACK_MAX));
    else if (field === "cooldown") attack.cooldown = clamp(value, 0.01, 10);
    else if (field === "range") attack.range = clamp(value, 0.01, 50);
    else return;
    applyStateToControls();
    setAssetSettingsStatus("Unsaved changes");
  }

  function setEnemyDropChance(chance: number): void {
    const settings = activeSidecar();
    if (settings.kind !== "enemy") return;
    settings.dropTable.chance = clamp(chance, DROP_CHANCE_MIN, DROP_CHANCE_MAX);
    applyStateToControls();
    setAssetSettingsStatus("Unsaved changes");
  }

  function setEnemyDropEntryField(kind: ResourceKind, field: string | undefined, value: number): void {
    const settings = activeSidecar();
    if (settings.kind !== "enemy") return;
    const entry = enemyDropEntry(settings, kind);
    if (field === "amount") entry.amount = Math.round(clamp(value, 1, HEALTH_MAX));
    else if (field === "weight") entry.weight = Math.round(clamp(value, 1, HEALTH_MAX));
    else return;
    applyStateToControls();
    setAssetSettingsStatus("Unsaved changes");
  }

  function setCollisionVisible(visible: boolean): void {
    state.collisionVisible = visible;
    applyCollisionPreview();
    applyStateToControls();
    syncUrl();
  }

  function setCollisionEditMode(enabled: boolean): void {
    state.collisionEditMode = enabled;
    applyCollisionPreview();
    applyStateToControls();
    syncUrl();
  }

  function applyCollisionPreview(): void {
    updateCollisionPreview(collisionPreview, activeSidecar().collision.radius);
    collisionPreview.root.visible = state.collisionVisible;
    collisionPreview.handle.visible = state.collisionVisible && state.collisionEditMode;
  }

  function setAssetSettingsStatus(text: string): void {
    assetSettingsStatus.textContent = text;
  }

  async function saveActiveAssetSettings(): Promise<void> {
    assetSettingsSaveButton.disabled = true;
    setAssetSettingsStatus("Saving...");
    try {
      const response = await fetch(`/__dev/assets/${state.assetKey}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(activeSidecar()),
      });
      if (!response.ok) throw new Error(await response.text());
      const saved = (await response.json()) as AssetSidecar;
      state.assetSettings[state.assetKey] = saved;
      activeRecord().sidecar = saved;
      activeRecord().sidecarExists = true;
      setAssetSettingsStatus("Saved");
      applyStateToControls();
    } catch (error) {
      console.error(error);
      setAssetSettingsStatus(error instanceof Error ? error.message : "Save failed");
    } finally {
      assetSettingsSaveButton.disabled = false;
    }
  }

  function applyRenderMode(): void {
    if (!loadedModel) return;
    setWireframe(loadedModel.root, state.renderMode === "wireframe" || state.renderMode === "bones");
    if (loadedModel.boneHelper) loadedModel.boneHelper.visible = state.renderMode === "bones";
  }

  function applyAnimationSelection(): void {
    if (!loadedModel?.mixer) return;
    loadedModel.activeAction?.stop();
    loadedModel.activeAction = null;
    if (state.animation === "base-pose") {
      loadedModel.mixer.stopAllAction();
      return;
    }
    const clip = findAnimationClip(loadedModel.clips, state.animation);
    if (!clip) return;
    const action = loadedModel.mixer.clipAction(clip);
    action.reset().play();
    action.paused = !state.playing;
    action.timeScale = state.speed;
    loadedModel.activeAction = action;
  }

  function cameraAnchorPosition(): THREE.Vector3 {
    if (customCameraDirection) return cameraPositionForDirection(customCameraDirection, target);
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
    cameraTransition = { fromOffset, toOffset, elapsed: 0, duration: CAMERA_TRANSITION_SECONDS };
  }

  function updateCamera(dt: number): void {
    if (!cameraTransition) {
      applyCameraOffset(desiredCameraOffset());
      return;
    }
    cameraTransition.elapsed += dt;
    const progress = clamp(cameraTransition.elapsed / cameraTransition.duration, 0, 1);
    applyCameraOffset(cameraTransition.fromOffset.clone().lerp(cameraTransition.toOffset, easeInOutCubic(progress)));
    if (progress >= 1) cameraTransition = null;
  }

  function resize(): void {
    const width = Math.max(canvasHost.clientWidth, 1);
    const height = Math.max(canvasHost.clientHeight, 1);
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    cameraGizmo.resize();
  }

  function animate(): void {
    if (disposed) return;
    requestAnimationFrame(animate);
    const rawDt = Math.min(clock.getDelta(), 0.033);
    const dt = state.playing ? rawDt * state.speed : 0;
    updateCamera(rawDt);
    if (loadedModel?.mixer && state.animation !== "base-pose") {
      if (loadedModel.activeAction) {
        loadedModel.activeAction.paused = !state.playing;
        loadedModel.activeAction.timeScale = state.speed;
      }
      loadedModel.mixer.update(dt);
    }
    loadedModel?.boneHelper?.updateMatrixWorld(true);
    renderer.render(scene, camera);
    cameraGizmo.render(camera, target);
    const assetMetrics = loadedModel ? measureAsset(loadedModel.root) : { renderCalls: 0, triangles: 0 };
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
    state.assetKey = assetSelect.value;
    state.animation = activeSidecar().preview?.defaultAnimation ?? "idle";
    setAssetSettingsStatus("Loading model...");
    void applyActiveAsset();
    syncUrl();
  });
  animationSelect.addEventListener("change", () => {
    state.animation = animationSelect.value;
    applyAnimationSelection();
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
  collisionToggle.addEventListener("change", () => setCollisionVisible(collisionToggle.checked));
  collisionEditToggle.addEventListener("change", () => setCollisionEditMode(collisionEditToggle.checked));
  assetCollisionRadiusInput.addEventListener("input", () => setAssetCollisionRadius(Number(assetCollisionRadiusInput.value)));
  assetHealthInput.addEventListener("input", () => setAssetHealth(Number(assetHealthInput.value)));
  assetSpeedInput.addEventListener("input", () => setAssetSpeed(Number(assetSpeedInput.value)));
  pickupResourcesInputs.forEach((input) => {
    input.addEventListener("input", () => setPickupResource(input.dataset.pickupResource as keyof PickupAssetSettings["resources"], Number(input.value)));
  });
  enemyGameplayInputs.forEach((input) => {
    input.addEventListener("input", () => setEnemyGameplayField(input.dataset.enemyGameplayField, Number(input.value)));
  });
  enemySpawnWeightInputs.forEach((input) => {
    input.addEventListener("input", () => setEnemySpawnField(input.dataset.enemySpawnField, input.value === "" ? Number.NaN : Number(input.value)));
  });
  enemyAttackInputs.forEach((input) => {
    input.addEventListener("input", () => setEnemyAttackField(input.dataset.enemyAttackField, Number(input.value)));
  });
  enemyDropChanceInput.addEventListener("input", () => setEnemyDropChance(Number(enemyDropChanceInput.value)));
  enemyDropEntryInputs.forEach((input) => {
    input.addEventListener("input", () => {
      setEnemyDropEntryField(toResourceKind(input.dataset.enemyDropKind), input.dataset.enemyDropField, Number(input.value));
    });
  });
  assetSettingsSaveButton.addEventListener("click", () => void saveActiveAssetSettings());

  renderer.domElement.addEventListener("pointerdown", (event) => {
    if (state.collisionEditMode && pickCollisionHandle(event)) {
      collisionDragPointerId = event.pointerId;
      renderer.domElement.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    renderer.domElement.setPointerCapture(event.pointerId);
    cameraTransition = null;
    const cameraOffset = camera.position.clone().sub(target).divideScalar(state.cameraDistance);
    customOrbitAngle = Math.atan2(cameraOffset.x, cameraOffset.z);
    customOrbitRadius = Math.max(Math.hypot(cameraOffset.x, cameraOffset.z), CAMERA_VIEW_RADIUS);
    dragStart = { x: event.clientX, angle: customOrbitAngle };
  });
  renderer.domElement.addEventListener("pointermove", (event) => {
    if (collisionDragPointerId === event.pointerId) {
      if (intersectGround(event, dragPoint)) setAssetCollisionRadius(Math.hypot(dragPoint.x, dragPoint.z));
      return;
    }
    if (!dragStart) return;
    usingCustomOrbit = true;
    customCameraDirection = null;
    customOrbitAngle = dragStart.angle + (event.clientX - dragStart.x) * 0.01;
    applyStateToControls();
  });
  renderer.domElement.addEventListener("pointerup", (event) => {
    if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
    if (collisionDragPointerId === event.pointerId) collisionDragPointerId = null;
    dragStart = null;
  });

  function pickCollisionHandle(event: PointerEvent): boolean {
    pointerFromEvent(event, pointer, renderer.domElement);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObject(collisionPreview.handle, false).length > 0;
  }

  function intersectGround(event: PointerEvent, point: THREE.Vector3): boolean {
    pointerFromEvent(event, pointer, renderer.domElement);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.ray.intersectPlane(dragPlane, point) !== null;
  }

  window.addEventListener("resize", resize);
  window.addEventListener("pagehide", () => {
    disposed = true;
    disposeLoadedModel();
    cameraGizmo.dispose();
    renderer.dispose();
  });

  applyCollisionPreview();
  applyStateToControls();
  resize();
  startCameraTransition();
  await applyActiveAsset();
  animate();
}

async function loadAssetRecords(): Promise<EditorAssetRecord[]> {
  const response = await fetch("/__dev/assets");
  if (!response.ok) throw new Error("Asset discovery endpoint missing. Restart the Vite dev server.");
  const payload = (await response.json()) as { assets?: EditorAssetRecord[] };
  return (payload.assets ?? []).sort((a, b) => Number(a.staged) - Number(b.staged) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

function createLoadingMarkup(): string {
  return `<main class="asset-editor-empty"><h1>Asset Editor</h1><p>Loading assets...</p></main>`;
}

function createEmptyMarkup(message: string): string {
  return `<main class="asset-editor-empty"><h1>Asset Editor</h1><p>${escapeHtml(message)}</p></main>`;
}

function createAssetEditorMarkup(state: AssetEditorState, records: EditorAssetRecord[]): string {
  const angleButtons = Object.entries(CAMERA_POSES)
    .map(([id, pose]) => `<button type="button" data-angle="${id}" class="${id === state.angle ? "selected" : ""}">${pose.label}</button>`)
    .join("");
  const assetOptions = records
    .map((record) => {
      const key = assetKey(record);
      const prefix = record.staged ? "Staged: " : "";
      return `<option value="${key}" ${key === state.assetKey ? "selected" : ""}>${prefix}${record.label}</option>`;
    })
    .join("");
  const renderModeButtons = RENDER_MODES.map(
    (mode) => `<button type="button" data-render-mode="${mode.id}" class="${mode.id === state.renderMode ? "selected" : ""}">${mode.label}</button>`,
  ).join("");
  const settings = state.assetSettings[state.assetKey];

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
        <div class="asset-editor-title"><h1>Asset Editor</h1></div>
        <label><span>Asset</span><select id="assetSelect">${assetOptions}</select></label>
        <section class="asset-editor-section" aria-label="Render settings">
          <h2>Render Settings</h2>
          <div class="control-group"><span>Angle</span><div class="segmented-controls">${angleButtons}</div></div>
          <div class="control-group">
            <span>Camera Distance <strong id="cameraDistanceValue">${state.cameraDistance.toFixed(2)}x</strong></span>
            <div class="segmented-controls camera-distance-controls">
              <button id="cameraCloserButton" type="button">Closer</button>
              <button id="cameraResetButton" type="button">Reset</button>
              <button id="cameraAwayButton" type="button">Away</button>
            </div>
          </div>
          <label><span>Animation</span><select id="animationSelect"></select></label>
          <div class="control-group"><span>Render Mode</span><div class="segmented-controls">${renderModeButtons}</div></div>
          <label class="toggle-row"><span>Show Collision Circle</span><input id="collisionToggle" type="checkbox" ${state.collisionVisible ? "checked" : ""} /></label>
          <label class="toggle-row"><span>Edit Collision Radius</span><input id="collisionEditToggle" type="checkbox" ${state.collisionEditMode ? "checked" : ""} /></label>
          <label class="toggle-row"><span>Playback</span><input id="playToggle" type="checkbox" ${state.playing ? "checked" : ""} /></label>
          <label><span>Speed <strong id="speedValue">${state.speed.toFixed(1)}x</strong></span><input id="speedInput" type="range" min="0.1" max="2.5" step="0.1" value="${state.speed}" /></label>
        </section>
        <section class="asset-editor-section" aria-label="Asset settings">
          <h2>Asset Settings</h2>
          <label><span>Collision Radius</span><input id="assetCollisionRadiusInput" type="number" min="${COLLISION_RADIUS_MIN}" max="${COLLISION_RADIUS_MAX}" step="0.01" value="${settings.collision.radius.toFixed(2)}" /></label>
          <label id="assetHealthField"><span>Health</span><input id="assetHealthInput" type="number" min="${HEALTH_MIN}" max="${HEALTH_MAX}" step="1" value="${assetHealthValue(settings)}" /></label>
          <label id="assetSpeedField"><span id="assetSpeedLabel">Movement Speed</span><input id="assetSpeedInput" type="number" min="${ASSET_SPEED_MIN}" max="${ASSET_SPEED_MAX}" step="0.01" value="${assetSpeedValue(settings).toFixed(2)}" /></label>
          <div id="pickupResourcesField" class="asset-settings-grid">
            <label><span>Health Grant</span><input data-pickup-resource="health" type="number" min="0" max="${HEALTH_MAX}" step="1" value="0" /></label>
            <label><span>Ammo Grant</span><input data-pickup-resource="ammo" type="number" min="0" max="${HEALTH_MAX}" step="1" value="0" /></label>
            <label><span>Energy Grant</span><input data-pickup-resource="energy" type="number" min="0" max="${HEALTH_MAX}" step="1" value="0" /></label>
          </div>
          <div id="enemyGameplayField" class="enemy-settings-stack">
            <div class="enemy-settings-group"><h3>Gameplay</h3><div class="asset-settings-grid">
              ${enemyGameplayInput("unlockMapDepth", "Unlock Depth", 1, 99, 1)}
              ${enemyGameplayInput("budgetCost", "Budget Cost", 0.01, 99, 0.01)}
              ${enemyGameplayInput("attackDamageLevelGrowth", "Damage Growth", 0, 99, 0.01)}
              ${enemyGameplayInput("xpReward.base", "XP Base", 0, 999, 0.1)}
              ${enemyGameplayInput("xpReward.levelGrowth", "XP Growth", 0, 999, 0.1)}
            </div></div>
          </div>
          <div id="enemyCombatField" class="enemy-settings-stack">
            <div class="enemy-settings-group"><h3>Spawn Weight</h3><div class="asset-settings-grid">
              ${enemySpawnInput("base", "Base", 0.001, 10, 0.001)}
              ${enemySpawnInput("levelGrowth", "Level Growth", -10, 10, 0.001)}
              ${enemySpawnInput("min", "Min", 0, 10, 0.001)}
              ${enemySpawnInput("max", "Max", 0.001, 10, 0.001)}
            </div></div>
            <div class="enemy-settings-group"><h3>Primary Attack</h3><div class="asset-settings-grid">
              <label><span>Damage</span><input data-enemy-attack-field="damage" type="number" min="1" max="${ENEMY_ATTACK_MAX}" step="1" value="1" /></label>
              <label><span>Cooldown</span><input data-enemy-attack-field="cooldown" type="number" min="0.01" max="10" step="0.01" value="1" /></label>
              <label><span>Range</span><input data-enemy-attack-field="range" type="number" min="0.01" max="50" step="0.01" value="1" /></label>
            </div></div>
            <div class="enemy-settings-group">
              <h3>Drop Table</h3>
              <label><span>Drop Chance</span><input id="enemyDropChanceInput" type="number" min="${DROP_CHANCE_MIN}" max="${DROP_CHANCE_MAX}" step="0.001" value="0" /></label>
              <div class="drop-table-editor">${dropTableEditorRow("health", "Health")}${dropTableEditorRow("ammo", "Ammo")}${dropTableEditorRow("energy", "Energy")}</div>
            </div>
          </div>
          <label><span>Raw Sidecar</span><textarea id="rawJson" readonly rows="12"></textarea></label>
          <div class="asset-settings-actions"><button id="assetSettingsSaveButton" type="button">Save Asset Settings</button><span id="assetSettingsStatus">Loaded</span></div>
        </section>
      </aside>
    </main>
  `;
}

function readStateFromUrl(records: EditorAssetRecord[]): AssetEditorState {
  const params = new URLSearchParams(window.location.search);
  const selected = recordFromUrl(records, params) ?? records[0];
  const key = assetKey(selected);
  return {
    assetKey: key,
    angle: toAngleId(params.get("angle")),
    animation: params.get("state") ?? params.get("animation") ?? selected.sidecar.preview?.defaultAnimation ?? "idle",
    cameraDistance: clamp(Number(params.get("distance") ?? STANDARD_CAMERA_DISTANCE), CAMERA_DISTANCE_MIN, CAMERA_DISTANCE_MAX),
    speed: clamp(Number(params.get("speed") ?? "1"), 0.1, 2.5),
    playing: params.get("paused") !== "1",
    renderMode: toRenderModeId(params.get("mode")),
    collisionVisible: params.get("hideCollision") !== "1",
    collisionEditMode: params.get("editCollision") === "1",
    assetSettings: Object.fromEntries(records.map((record) => [assetKey(record), structuredClone(record.sidecar)])),
  };
}

function recordFromUrl(records: EditorAssetRecord[], params: URLSearchParams): EditorAssetRecord | null {
  const asset = params.get("asset");
  const staged = params.get("staged") === "1";
  if (!asset) return null;
  if (asset.includes("/")) {
    const [category, name] = asset.split("/");
    return records.find((record) => record.category === category && record.name === name && record.staged === staged) ?? null;
  }
  return records.find((record) => record.name === asset && record.staged === staged) ?? null;
}

function assetKey(record: EditorAssetRecord): string {
  return record.staged ? `_staged/${record.category}/${record.name}` : `${record.category}/${record.name}`;
}

function loadGltf(loader: GLTFLoader, url: string): Promise<GLTF> {
  return new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));
}

function createAnimationOptions(model: LoadedModel | null, fallback: string): Array<{ id: string; label: string }> {
  const options = [{ id: "base-pose", label: "Base Pose" }];
  const clips = model?.clips ?? [];
  for (const clip of clips) options.push({ id: clip.name, label: labelFromSlug(clip.name) });
  if (!options.some((entry) => entry.id === fallback)) options.push({ id: fallback, label: labelFromSlug(fallback) });
  return options;
}

function syncAnimationOptions(select: HTMLSelectElement, state: AssetEditorState, model: LoadedModel | null): void {
  const fallback = state.assetSettings[state.assetKey]?.preview?.defaultAnimation ?? "idle";
  const optionsMarkup = createAnimationOptions(model, fallback)
    .map((entry) => `<option value="${escapeHtml(entry.id)}" ${entry.id === state.animation ? "selected" : ""}>${escapeHtml(entry.label)}</option>`)
    .join("");
  if (select.innerHTML !== optionsMarkup) select.innerHTML = optionsMarkup;
}

function ensureAnimationForLoadedModel(animation: string, model: LoadedModel): string {
  if (animation === "base-pose") return animation;
  if (findAnimationClip(model.clips, animation)) return animation;
  return model.record.sidecar.preview?.defaultAnimation ?? "idle";
}

function findAnimationClip(clips: THREE.AnimationClip[], name: string): THREE.AnimationClip | null {
  return clips.find((clip) => clip.name === name) ?? clips.find((clip) => clip.name.toLowerCase() === name.toLowerCase()) ?? null;
}

function hasHealth(settings: AssetSidecar): settings is EnemySidecar | PlayerSidecar {
  return settings.kind === "enemy" || settings.kind === "player";
}

function hasMovementSpeed(settings: AssetSidecar): settings is EnemySidecar | PlayerSidecar {
  return settings.kind === "enemy" || (settings.kind === "player" && settings.movement !== undefined);
}

function getMovementSpeed(settings: EnemySidecar | PlayerSidecar): number {
  return settings.kind === "enemy" ? settings.movement.speed : settings.movement?.speed ?? 0;
}

function setMovementSpeed(settings: EnemySidecar | PlayerSidecar, speed: number): void {
  if (settings.kind === "enemy") settings.movement.speed = speed;
  else settings.movement = { speed };
}

function assetHealthValue(settings: AssetSidecar): number {
  if (settings.kind === "enemy") return settings.health.base;
  return hasHealth(settings) ? settings.health : 0;
}

function assetSpeedValue(settings: AssetSidecar): number {
  return hasMovementSpeed(settings) ? getMovementSpeed(settings) : 0;
}

function primaryEditableAttack(settings: EnemySidecar): EnemyAttackDefinition {
  const melee = settings.attacks.find((attack) => attack.kind === "melee");
  return melee ?? settings.attacks[0];
}

function enemyAttackInputValue(attack: EnemyAttackDefinition, field: string | undefined): number {
  if (field === "damage") return attack.damage;
  if (field === "cooldown") return attack.cooldown;
  if (field === "range") return attack.range;
  return 0;
}

function enemyDropEntry(settings: EnemySidecar, kind: ResourceKind): EnemySidecar["dropTable"]["entries"][number] {
  let entry = settings.dropTable.entries.find((candidate) => candidate.kind === kind);
  if (!entry) {
    entry = { kind, weight: 1, amount: 1 };
    settings.dropTable.entries.push(entry);
  }
  return entry;
}

function enemySpawnInputValue(settings: EnemySidecar, field: string | undefined): string {
  if (field === "base") return settings.spawnWeight.base.toString();
  if (field === "levelGrowth") return settings.spawnWeight.levelGrowth.toString();
  if (field === "min") return settings.spawnWeight.min?.toString() ?? "";
  if (field === "max") return settings.spawnWeight.max?.toString() ?? "";
  return "";
}

function toResourceKind(value: string | undefined): ResourceKind {
  if (value === "health" || value === "ammo" || value === "energy") return value;
  return "health";
}

function enemyGameplayInput(field: string, label: string, min: number, max: number, step: number): string {
  return `<label><span>${label}</span><input data-enemy-gameplay-field="${field}" type="number" min="${min}" max="${max}" step="${step}" value="0" /></label>`;
}

function enemySpawnInput(field: string, label: string, min: number, max: number, step: number): string {
  return `<label><span>${label}</span><input data-enemy-spawn-field="${field}" type="number" min="${min}" max="${max}" step="${step}" value="" /></label>`;
}

function dropTableEditorRow(kind: ResourceKind, label: string): string {
  return `
    <div class="drop-table-row">
      <span>${label}</span>
      <label><span>Weight</span><input data-enemy-drop-kind="${kind}" data-enemy-drop-field="weight" type="number" min="1" max="${HEALTH_MAX}" step="1" value="1" /></label>
      <label><span>Amount</span><input data-enemy-drop-kind="${kind}" data-enemy-drop-field="amount" type="number" min="1" max="${HEALTH_MAX}" step="1" value="1" /></label>
    </div>
  `;
}

function applyGameMaterialConventions(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
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

function hasSkinnedMeshes(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) found = true;
  });
  return found;
}

function createBoneHelper(root: THREE.Object3D): THREE.SkeletonHelper {
  const helper = new THREE.SkeletonHelper(root);
  helper.visible = false;
  helper.frustumCulled = false;
  helper.material = new THREE.LineBasicMaterial({
    color: 0xffc857,
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
    const calls = countMeshRenderCalls(object);
    if (calls === 0) return;
    metrics.renderCalls += calls;
    metrics.triangles += countRenderedTriangles(object.geometry, object.material);
  });
  return metrics;
}

function countMeshRenderCalls(mesh: THREE.Mesh): number {
  const material = mesh.material;
  if (Array.isArray(material)) {
    if (mesh.geometry.groups.length === 0) return material.filter((entry) => entry.visible).length;
    return mesh.geometry.groups.filter((group) => material[group.materialIndex ?? 0]?.visible ?? true).length;
  }
  return material.visible ? 1 : 0;
}

function countRenderedTriangles(geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]): number {
  const indexCount = geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0;
  const drawStart = Math.min(geometry.drawRange.start, indexCount);
  const drawEnd =
    geometry.drawRange.count === Infinity ? indexCount : Math.min(indexCount, geometry.drawRange.start + geometry.drawRange.count);
  if (geometry.groups.length === 0) return Math.floor(Math.max(0, drawEnd - drawStart) / 3);
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
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power", preserveDrawingBuffer: true });
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
  const faceColorByAxis = { x: 0xff7b73, y: 0x8bffb5, z: 0x7c95ff };
  const faceDirections = [
    { label: "RIGHT", direction: new THREE.Vector3(1, 0, 0), color: faceColorByAxis.x },
    { label: "LEFT", direction: new THREE.Vector3(-1, 0, 0), color: faceColorByAxis.x },
    { label: "TOP", direction: new THREE.Vector3(0, 1, 0), color: faceColorByAxis.y },
    { label: "BOTTOM", direction: new THREE.Vector3(0, -1, 0), color: faceColorByAxis.y },
    { label: "BACK", direction: new THREE.Vector3(0, 0, 1), color: faceColorByAxis.z },
    { label: "FRONT", direction: new THREE.Vector3(0, 0, -1), color: faceColorByAxis.z },
  ];

  for (const face of faceDirections) {
    const mesh = new THREE.Mesh(faceGeometry, createGizmoFaceMaterial(face.label, face.color));
    mesh.position.copy(face.direction).multiplyScalar(halfSize);
    orientObjectTowardDirection(mesh, face.direction);
    addGizmoPickable(root, pickables, mesh, face.direction);
  }

  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        const direction = new THREE.Vector3(x, y, z);
        const corner = new THREE.Mesh(new THREE.SphereGeometry(0.105, 18, 12), createGizmoHandleMaterial(0xf4fbff, 0.98));
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
        edge.position.set(axis === "x" ? 0 : a * halfSize, axis === "y" ? 0 : (axis === "x" ? a : b) * halfSize, axis === "z" ? 0 : b * halfSize);
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
    pointerFromEvent(event, pointer, renderer.domElement);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0]?.object;
    return hit instanceof THREE.Mesh ? hit : null;
  }

  renderer.domElement.addEventListener("pointermove", (event) => setHovered(pickGizmoObject(event)));
  renderer.domElement.addEventListener("pointerleave", () => setHovered(null));
  renderer.domElement.addEventListener("pointerdown", (event) => event.preventDefault());
  renderer.domElement.addEventListener("click", (event) => {
    const direction = pickGizmoObject(event)?.userData.cameraDirection;
    if (direction instanceof THREE.Vector3) onDirectionSelected(direction);
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
        disposeMaterial(object.material);
      } else if (object instanceof THREE.Sprite) {
        disposeMaterial(object.material);
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
  return new THREE.MeshStandardMaterial({ color, emissive: 0x06100f, roughness: 0.52, metalness: 0.14, transparent: true, opacity });
}

function createGizmoFaceMaterial(label: string, color: THREE.ColorRepresentation): THREE.MeshStandardMaterial {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const baseColor = new THREE.Color(color);
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, `rgba(${Math.round(baseColor.r * 255)}, ${Math.round(baseColor.g * 255)}, ${Math.round(baseColor.b * 255)}, 0.86)`);
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
  return new THREE.MeshStandardMaterial({ map: texture, color: 0xffffff, roughness: 0.62, metalness: 0.08, transparent: true, opacity: 0.78, side: THREE.DoubleSide });
}

function applyGizmoHover(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>, hovered: boolean): void {
  const baseColor = mesh.userData.baseColor;
  const baseOpacity = mesh.userData.baseOpacity;
  if (baseColor instanceof THREE.Color) mesh.material.color.copy(hovered ? new THREE.Color(0xffffff) : baseColor);
  mesh.material.emissive.setHex(hovered ? 0x9bf0df : 0x06100f);
  mesh.material.opacity = hovered ? 1 : typeof baseOpacity === "number" ? baseOpacity : mesh.material.opacity;
}

function orientObjectTowardDirection(object: THREE.Object3D, direction: THREE.Vector3): void {
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.clone().normalize());
}

function cameraPositionForDirection(direction: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
  const normalized = direction.clone().normalize();
  const position = target.clone().add(normalized.multiplyScalar(CAMERA_VIEW_RADIUS));
  if (Math.abs(direction.y) < 0.001) position.y = 1.65;
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
  camera.up.set(0, horizontalDistance < 0.001 ? 0 : 1, horizontalDistance < 0.001 && camera.position.y >= target.y ? -1 : 0);
  camera.lookAt(target);
}

function createInspectionFloor(): THREE.Group {
  const root = new THREE.Group();
  const grid = new THREE.GridHelper(5, 10, 0x2ddbd2, 0x263235);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(1.55, 64),
    new THREE.MeshStandardMaterial({ color: 0x0b1113, roughness: 0.72, metalness: 0.4, transparent: true, opacity: 0.78 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(grid, floor);
  return root;
}

function createCollisionPreview(): CollisionPreview {
  const root = new THREE.Group();
  root.name = "collision-circle-preview";
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.98, 1, 96),
    new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.name = "collision-ground-circle";
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.012;
  ring.renderOrder = 11;
  const handle = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 18, 12),
    new THREE.MeshStandardMaterial({ color: 0xffd166, emissive: 0x2a1800, roughness: 0.35, metalness: 0.1 }),
  );
  handle.name = "collision-radius-handle";
  handle.position.y = 0.085;
  handle.renderOrder = 12;
  root.add(ring, handle);
  return { root, ring, handle };
}

function updateCollisionPreview(preview: CollisionPreview, radius: number): void {
  preview.ring.scale.setScalar(radius);
  preview.handle.position.x = radius;
  preview.handle.position.z = 0;
}

function addAxisMarkers(scene: THREE.Scene): void {
  const front = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.28, 3), new THREE.MeshBasicMaterial({ color: 0x54f5ff }));
  front.position.set(0, 0.08, -1.85);
  front.rotation.x = -Math.PI / 2;
  scene.add(front);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.16), new THREE.MeshBasicMaterial({ color: 0xff3f4f }));
  back.position.set(0, 0.08, 1.85);
  scene.add(back);
}

function disposeGltf(gltf: GLTF): void {
  disposeObject3D(gltf.scene);
}

function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    disposeMaterial(object.material);
  });
}

function disposeMaterial(material: THREE.Material | THREE.Material[] | undefined): void {
  if (!material) return;
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial);
    return;
  }
  const maybeMapped = material as THREE.Material & Record<string, unknown>;
  for (const value of Object.values(maybeMapped)) {
    if (value instanceof THREE.Texture) value.dispose();
  }
  material.dispose();
}

function pointerFromEvent(event: PointerEvent | MouseEvent, target: THREE.Vector2, element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  target.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1));
}

function toAngleId(value: string | null | undefined): AngleId {
  return value === "head-on" || value === "side" || value === "behind" || value === "isometric" ? value : "isometric";
}

function toRenderModeId(value: string | null | undefined): RenderModeId {
  return value === "wireframe" || value === "bones" ? value : "shaded";
}

function labelFromSlug(value: string): string {
  return value
    .replace(/[_:./]+/g, "-")
    .split("-")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    if (character === '"') return "&quot;";
    return "&#39;";
  });
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function easeInOutCubic(value: number): number {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}
