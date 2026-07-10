import { CircleHelp, LogOut, Play, Settings, createElement, type IconNode } from "lucide";
import { DEFAULT_AUDIO_SETTINGS, type AudioSettings } from "./audio";
import { key, type LevelData, type TileCoord } from "./level";
import { minimapWallEdges, MINIMAP_VIEW_TILES } from "./minimap";
import type { PlayerResources } from "./resourceTypes";
import type { CameraViewMode, GraphicsSettings } from "./scene";
import type { UpgradeId, UpgradeOption } from "./upgrades";

export type CameraSettings = {
  smoothFollow: boolean;
  pointerLead: boolean;
  aimFraming: boolean;
  velocityLead: boolean;
  shake: boolean;
};

export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  smoothFollow: false,
  pointerLead: false,
  aimFraming: true,
  velocityLead: true,
  shake: true,
};

type HudState = {
  resources: PlayerResources;
  maxResources: PlayerResources;
  kills: number;
  mapDepth: number;
  progression: {
    level: number;
    xp: number;
    xpToNextLevel: number;
    unspentUpgradePoints: number;
  };
  primaryReady: boolean;
  novaReady: boolean;
  dashUnlocked: boolean;
  dashReady: boolean;
  minimap: {
    level: LevelData;
    playerTile: TileCoord;
    playerRotation: number;
    explored: ReadonlySet<string>;
  };
};

export type Ui = {
  startButton: HTMLButtonElement;
  resumeButton: HTMLButtonElement;
  mainMenuButton: HTMLButtonElement;
  overlay: HTMLDivElement;
  pauseMenu: HTMLDivElement;
  showLoading: (message: string) => void;
  showStartError: (message: string) => void;
  showGameOver: (kills: number) => void;
  showMainMenu: () => void;
  hideOverlay: () => void;
  setHudVisible: (visible: boolean) => void;
  setPaused: (paused: boolean) => void;
  getStartMapDepth: () => number;
  setFpsVisible: (visible: boolean) => void;
  updateFps: (fps: number) => void;
  updateCameraDebug: (angles: { pitchDegrees: number; yawDegrees: number }) => void;
  onAudioSettingsChange: (listener: (settings: AudioSettings) => void) => void;
  onGraphicsSettingsChange: (listener: (settings: GraphicsSettings) => void) => void;
  onCameraSettingsChange: (listener: (settings: CameraSettings) => void) => void;
  updateHud: (state: HudState) => void;
  showUpgradeSelection: (state: { points: number; options: UpgradeOption[] }, onSelect: (id: UpgradeId) => void) => void;
  hideUpgradeSelection: () => void;
};

export function createUi(app: HTMLDivElement): Ui {
  const startDepthOptions = Array.from({ length: 10 }, (_, index) => {
    const level = index + 1;
    return `<option value="${level}">${level}</option>`;
  }).join("");
  const devStartCard = import.meta.env.DEV
    ? `
      <aside class="dev-start-card" aria-label="Dev environment controls">
        <strong>Dev Menu</strong>
        <label class="start-level">
          <span>Start Depth</span>
          <select id="startMapDepth">
            ${startDepthOptions}
          </select>
        </label>
        <a class="dev-menu-link" href="/dev/assets">Assets</a>
        <a class="dev-menu-link" href="/dev/effects">Effects</a>
      </aside>
    `
    : "";

  app.innerHTML = `
    <div class="overlay" id="overlay">
      <div class="start">
        <h1>Daemon Syndicate</h1>
        <p>Clear the alien-infested corporate black-site. Breach deeper, adapt fast, and survive whatever the syndicate buried below.</p>
        <div class="start-status" id="startStatus" role="status" aria-live="polite"></div>
        <div class="start-actions">
          <button id="start">Deploy</button>
        </div>
      </div>
      <div class="deploy-panel hidden" id="deployPanel" role="status" aria-live="polite" aria-atomic="true">
        <span>Deployment</span>
        <strong id="deployTitle">Deploying</strong>
        <p id="deployStatus"></p>
        <button id="deployRetry" type="button" class="hidden">Retry</button>
      </div>
      ${devStartCard}
    </div>
    <div class="hud hidden">
      <div class="topbar">
        <div class="resource-stack">
          <div class="resource health">
            <div class="resource-head"><span>Health</span><strong id="healthValue">100</strong></div>
            <div class="meter"><i id="healthMeter"></i></div>
          </div>
          <div class="resource ammo">
            <div class="resource-head"><span>Ammo</span><strong id="ammoValue">200</strong></div>
            <div class="meter"><i id="ammoMeter"></i></div>
          </div>
          <div class="resource energy">
            <div class="resource-head"><span>Energy</span><strong id="energyValue">100</strong></div>
            <div class="meter"><i id="energyMeter"></i></div>
          </div>
        </div>
        <div class="stats">
          <div class="stat"><span>Kills</span><strong id="kills">0</strong></div>
          <div class="stat"><span>Depth</span><strong id="mapDepth">1</strong></div>
          <div class="stat"><span>Rank</span><strong id="playerLevel">1</strong></div>
          <div class="stat"><span>XP</span><strong id="playerXp">0/100</strong></div>
          <div class="stat fps-stat hidden" id="fpsStat" title="Copy camera pitch and yaw">
            <span>Debug</span>
            <strong><b id="fpsValue">0</b> FPS</strong>
            <small>Pitch <b id="cameraPitchValue">0.0</b></small>
            <small>Yaw <b id="cameraYawValue">0.0</b></small>
          </div>
        </div>
      </div>
      <div class="ability-bar">
        <div class="ability" id="primaryAbility"><strong>LMB</strong><span>Bolt</span><em>Ammo</em></div>
        <div class="ability" id="novaAbility"><strong>RMB</strong><span>Nova</span><em>Energy</em></div>
        <div class="ability hidden" id="dashAbility"><strong>Shift</strong><span>Dash</span><em>Energy</em></div>
      </div>
      <aside class="minimap-card" aria-label="Explored area minimap">
        <canvas id="minimap" width="176" height="176"></canvas>
      </aside>
    </div>
    <div class="pause-menu hidden" id="pauseMenu" role="dialog" aria-modal="true" aria-labelledby="pauseTitle">
      <div class="pause-panel" data-pause-view="main">
        <div class="pause-head">
          <span aria-hidden="true">///</span>
          <h2 id="pauseTitle">Mission Paused</h2>
          <span aria-hidden="true">///</span>
        </div>
        <nav class="pause-view pause-view-main" aria-label="Pause menu">
          <button class="pause-option" id="resume">
            ${pauseIconMarkup(Play, "icon-continue")}
            <span>Continue</span>
          </button>
          <button class="pause-option" id="settingsButton">
            ${pauseIconMarkup(Settings, "icon-settings")}
            <span>Settings</span>
          </button>
          <button class="pause-option" id="helpButton">
            ${pauseIconMarkup(CircleHelp, "icon-help")}
            <span>Help</span>
          </button>
          <button class="pause-option" id="mainMenuButton">
            ${pauseIconMarkup(LogOut, "icon-main-menu")}
            <span>Exit to Main Menu</span>
          </button>
        </nav>
        <section class="pause-view pause-view-settings" aria-label="Settings">
          <button class="pause-back" id="settingsBack" type="button">Back</button>
          <div class="pause-section">
            <h3>Camera</h3>
            <label class="setting-row setting-toggle">
              <span class="setting-label">Smooth follow</span>
              <input id="cameraSmoothFollow" type="checkbox" />
            </label>
            <label class="setting-row setting-toggle">
              <span class="setting-label">Pointer lead</span>
              <input id="cameraPointerLead" type="checkbox" />
            </label>
            <label class="setting-row setting-toggle">
              <span class="setting-label">Aim framing</span>
              <input id="cameraAimFraming" type="checkbox" checked />
            </label>
            <label class="setting-row setting-toggle">
              <span class="setting-label">Velocity lead</span>
              <input id="cameraVelocityLead" type="checkbox" checked />
            </label>
            <label class="setting-row setting-toggle">
              <span class="setting-label">Impact shake</span>
              <input id="cameraShake" type="checkbox" checked />
            </label>
          </div>
          <div class="pause-section">
            <h3>Graphics</h3>
            <div class="setting-row">
              <div>
                <span class="setting-label">View style</span>
              </div>
              <div class="camera-view-options" role="group" aria-label="View style">
                <button class="graphics-camera-option selected" type="button" aria-pressed="true" data-camera-view="depth">Depth</button>
                <button class="graphics-camera-option" type="button" aria-pressed="false" data-camera-view="flat">Flat</button>
              </div>
            </div>
            <label class="setting-row setting-toggle">
              <span class="setting-label">Preserve buffer</span>
              <input id="preserveDrawingBuffer" type="checkbox" />
            </label>
            <div class="setting-row">
              <div>
                <span class="setting-label">Render scale</span>
              </div>
              <div class="graphics-options" role="group" aria-label="Render scale">
                <button class="graphics-render-scale-option" type="button" aria-pressed="false" data-render-scale="0.25">0.25x</button>
                <button class="graphics-render-scale-option" type="button" aria-pressed="false" data-render-scale="0.5">0.5x</button>
                <button class="graphics-render-scale-option selected" type="button" aria-pressed="true" data-render-scale="1">Native</button>
              </div>
            </div>
          </div>
          <div class="pause-section">
            <h3>Audio</h3>
            <label class="setting-row setting-toggle">
              <span class="setting-label">Mute</span>
              <input id="audioMuted" type="checkbox" />
            </label>
            <label class="setting-row">
              <div>
                <span class="setting-label">Master</span>
                <small class="setting-value" id="masterVolumeValue">82%</small>
              </div>
              <input class="audio-slider" id="masterVolume" type="range" min="0" max="1" step="0.01" />
            </label>
            <label class="setting-row">
              <div>
                <span class="setting-label">SFX</span>
                <small class="setting-value" id="sfxVolumeValue">90%</small>
              </div>
              <input class="audio-slider" id="sfxVolume" type="range" min="0" max="1" step="0.01" />
            </label>
          </div>
        </section>
        <section class="pause-view pause-view-help" aria-label="Help">
          <button class="pause-back" id="helpBack" type="button">Back</button>
          <h3>Help</h3>
          <dl>
            <div><dt>Move</dt><dd>WASD</dd></div>
            <div><dt>Aim</dt><dd>Mouse cursor</dd></div>
            <div><dt>Kinetic bolt</dt><dd>Left click, costs ammo</dd></div>
            <div><dt>Plasma nova</dt><dd>Right click or Space, costs energy</dd></div>
            <div><dt>Gate</dt><dd>Reach the glowing exit to generate the next depth</dd></div>
            <div><dt>Pause</dt><dd>Escape</dd></div>
          </dl>
          <p>Enemies can drop ammo, energy, or health refills. Energy also regenerates slowly over time.</p>
        </section>
      </div>
    </div>
    <div class="upgrade-menu hidden" id="upgradeMenu" role="dialog" aria-modal="true" aria-labelledby="upgradeTitle">
      <div class="upgrade-panel">
        <div class="upgrade-head">
          <h2 id="upgradeTitle">Upgrade</h2>
          <strong id="upgradePoints">1 point</strong>
        </div>
        <div class="upgrade-options" id="upgradeOptions"></div>
      </div>
    </div>
  `;

  const overlay = document.querySelector<HTMLDivElement>("#overlay")!;
  const hud = document.querySelector<HTMLDivElement>(".hud")!;
  const pauseMenu = document.querySelector<HTMLDivElement>("#pauseMenu")!;
  const upgradeMenu = document.querySelector<HTMLDivElement>("#upgradeMenu")!;
  const upgradePoints = document.querySelector<HTMLElement>("#upgradePoints")!;
  const upgradeOptions = document.querySelector<HTMLDivElement>("#upgradeOptions")!;
  const pausePanel = document.querySelector<HTMLDivElement>(".pause-panel")!;
  const startButton = document.querySelector<HTMLButtonElement>("#start")!;
  const startStatus = document.querySelector<HTMLDivElement>("#startStatus")!;
  const deployPanel = document.querySelector<HTMLDivElement>("#deployPanel")!;
  const deployTitle = document.querySelector<HTMLElement>("#deployTitle")!;
  const deployStatus = document.querySelector<HTMLParagraphElement>("#deployStatus")!;
  const deployRetry = document.querySelector<HTMLButtonElement>("#deployRetry")!;
  const startMapDepth = import.meta.env.DEV ? document.querySelector<HTMLSelectElement>("#startMapDepth") : null;
  const resumeButton = document.querySelector<HTMLButtonElement>("#resume")!;
  const settingsButton = document.querySelector<HTMLButtonElement>("#settingsButton")!;
  const helpButton = document.querySelector<HTMLButtonElement>("#helpButton")!;
  const mainMenuButton = document.querySelector<HTMLButtonElement>("#mainMenuButton")!;
  const settingsBack = document.querySelector<HTMLButtonElement>("#settingsBack")!;
  const helpBack = document.querySelector<HTMLButtonElement>("#helpBack")!;
  const healthValue = document.querySelector<HTMLElement>("#healthValue")!;
  const ammoValue = document.querySelector<HTMLElement>("#ammoValue")!;
  const energyValue = document.querySelector<HTMLElement>("#energyValue")!;
  const healthMeter = document.querySelector<HTMLElement>("#healthMeter")!;
  const ammoMeter = document.querySelector<HTMLElement>("#ammoMeter")!;
  const energyMeter = document.querySelector<HTMLElement>("#energyMeter")!;
  const killsEl = document.querySelector<HTMLElement>("#kills")!;
  const mapDepthEl = document.querySelector<HTMLElement>("#mapDepth")!;
  const playerLevelEl = document.querySelector<HTMLElement>("#playerLevel")!;
  const playerXpEl = document.querySelector<HTMLElement>("#playerXp")!;
  const fpsStat = document.querySelector<HTMLElement>("#fpsStat")!;
  const fpsValue = document.querySelector<HTMLElement>("#fpsValue")!;
  const cameraPitchValue = document.querySelector<HTMLElement>("#cameraPitchValue")!;
  const cameraYawValue = document.querySelector<HTMLElement>("#cameraYawValue")!;
  const primaryAbility = document.querySelector<HTMLElement>("#primaryAbility")!;
  const novaAbility = document.querySelector<HTMLElement>("#novaAbility")!;
  const dashAbility = document.querySelector<HTMLElement>("#dashAbility")!;
  const minimap = document.querySelector<HTMLCanvasElement>("#minimap")!;
  const cameraSmoothFollow = document.querySelector<HTMLInputElement>("#cameraSmoothFollow")!;
  const cameraPointerLead = document.querySelector<HTMLInputElement>("#cameraPointerLead")!;
  const cameraAimFraming = document.querySelector<HTMLInputElement>("#cameraAimFraming")!;
  const cameraVelocityLead = document.querySelector<HTMLInputElement>("#cameraVelocityLead")!;
  const cameraShake = document.querySelector<HTMLInputElement>("#cameraShake")!;
  const preserveDrawingBuffer = document.querySelector<HTMLInputElement>("#preserveDrawingBuffer")!;
  const cameraViewOptions = Array.from(pausePanel.querySelectorAll<HTMLButtonElement>(".graphics-camera-option"));
  const renderScaleOptions = Array.from(pausePanel.querySelectorAll<HTMLButtonElement>(".graphics-render-scale-option"));
  const audioMuted = document.querySelector<HTMLInputElement>("#audioMuted")!;
  const masterVolume = document.querySelector<HTMLInputElement>("#masterVolume")!;
  const masterVolumeValue = document.querySelector<HTMLElement>("#masterVolumeValue")!;
  const sfxVolume = document.querySelector<HTMLInputElement>("#sfxVolume")!;
  const sfxVolumeValue = document.querySelector<HTMLElement>("#sfxVolumeValue")!;
  let graphicsSettings: GraphicsSettings = {
    preserveDrawingBuffer: preserveDrawingBuffer.checked,
    renderScale: 1,
    cameraView: "depth",
  };
  let cameraSettings: CameraSettings = { ...DEFAULT_CAMERA_SETTINGS };
  let audioSettings = loadAudioSettings();
  const graphicsSettingsListeners: Array<(settings: GraphicsSettings) => void> = [];
  const cameraSettingsListeners: Array<(settings: CameraSettings) => void> = [];
  const audioSettingsListeners: Array<(settings: AudioSettings) => void> = [];
  let cameraDebugCopyValue = "pitch=0.0 yaw=0.0";

  cameraSmoothFollow.checked = cameraSettings.smoothFollow;
  cameraPointerLead.checked = cameraSettings.pointerLead;
  cameraAimFraming.checked = cameraSettings.aimFraming;
  cameraVelocityLead.checked = cameraSettings.velocityLead;
  cameraShake.checked = cameraSettings.shake;
  audioMuted.checked = audioSettings.muted;
  masterVolume.value = audioSettings.masterVolume.toString();
  sfxVolume.value = audioSettings.sfxVolume.toString();
  updateAudioVolumeLabels();

  function setMeter(el: HTMLElement, value: number, max: number): void {
    el.style.width = `${Math.max(0, Math.min(value / max, 1)) * 100}%`;
  }

  function showPauseView(view: "main" | "settings" | "help"): void {
    pausePanel.dataset.pauseView = view;
  }

  settingsButton.addEventListener("click", () => showPauseView("settings"));
  helpButton.addEventListener("click", () => showPauseView("help"));
  settingsBack.addEventListener("click", () => showPauseView("main"));
  helpBack.addEventListener("click", () => showPauseView("main"));

  function emitGraphicsSettings(): void {
    for (const listener of graphicsSettingsListeners) {
      listener({ ...graphicsSettings });
    }
  }

  function emitCameraSettings(): void {
    for (const listener of cameraSettingsListeners) {
      listener({ ...cameraSettings });
    }
  }

  function emitAudioSettings(): void {
    saveAudioSettings(audioSettings);
    for (const listener of audioSettingsListeners) {
      listener({ ...audioSettings });
    }
  }

  function updateAudioVolumeLabels(): void {
    masterVolumeValue.textContent = `${Math.round(audioSettings.masterVolume * 100)}%`;
    sfxVolumeValue.textContent = `${Math.round(audioSettings.sfxVolume * 100)}%`;
  }

  function setStartBusy(busy: boolean): void {
    startButton.disabled = busy;
    if (startMapDepth) startMapDepth.disabled = busy;
    startButton.classList.toggle("loading", busy);
  }

  function resetDeployPanel(): void {
    overlay.classList.remove("deploying", "deployment-error");
    deployPanel.classList.add("hidden");
    deployStatus.classList.remove("error");
    deployRetry.classList.add("hidden");
  }

  deployRetry.addEventListener("click", () => startButton.click());

  preserveDrawingBuffer.addEventListener("change", () => {
    graphicsSettings = {
      ...graphicsSettings,
      preserveDrawingBuffer: preserveDrawingBuffer.checked,
    };
    emitGraphicsSettings();
  });
  cameraViewOptions.forEach((option) => {
    option.addEventListener("click", () => {
      const nextView = cameraViewFromDataset(option.dataset.cameraView);
      if (!nextView) return;
      graphicsSettings = {
        ...graphicsSettings,
        cameraView: nextView,
      };

      cameraViewOptions.forEach((button) => {
        const selected = button === option;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", selected.toString());
      });
      emitGraphicsSettings();
    });
  });
  renderScaleOptions.forEach((option) => {
    option.addEventListener("click", () => {
      const nextRenderScale = renderScaleFromDataset(option.dataset.renderScale);
      if (!nextRenderScale) return;
      graphicsSettings = {
        ...graphicsSettings,
        renderScale: nextRenderScale,
      };

      renderScaleOptions.forEach((button) => {
        const selected = button === option;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", selected.toString());
      });
      emitGraphicsSettings();
    });
  });
  cameraSmoothFollow.addEventListener("change", () => {
    cameraSettings = { ...cameraSettings, smoothFollow: cameraSmoothFollow.checked };
    emitCameraSettings();
  });
  cameraPointerLead.addEventListener("change", () => {
    cameraSettings = { ...cameraSettings, pointerLead: cameraPointerLead.checked };
    emitCameraSettings();
  });
  cameraAimFraming.addEventListener("change", () => {
    cameraSettings = { ...cameraSettings, aimFraming: cameraAimFraming.checked };
    emitCameraSettings();
  });
  cameraVelocityLead.addEventListener("change", () => {
    cameraSettings = { ...cameraSettings, velocityLead: cameraVelocityLead.checked };
    emitCameraSettings();
  });
  cameraShake.addEventListener("change", () => {
    cameraSettings = { ...cameraSettings, shake: cameraShake.checked };
    emitCameraSettings();
  });
  audioMuted.addEventListener("change", () => {
    audioSettings = { ...audioSettings, muted: audioMuted.checked };
    emitAudioSettings();
  });
  fpsStat.addEventListener("click", () => {
    void navigator.clipboard?.writeText(cameraDebugCopyValue);
  });
  masterVolume.addEventListener("input", () => {
    audioSettings = { ...audioSettings, masterVolume: clamp01(Number(masterVolume.value)) };
    updateAudioVolumeLabels();
    emitAudioSettings();
  });
  sfxVolume.addEventListener("input", () => {
    audioSettings = { ...audioSettings, sfxVolume: clamp01(Number(sfxVolume.value)) };
    updateAudioVolumeLabels();
    emitAudioSettings();
  });

  return {
    startButton,
    resumeButton,
    mainMenuButton,
    overlay,
    pauseMenu,
    showLoading(message: string) {
      overlay.classList.remove("hidden");
      overlay.classList.add("deploying");
      overlay.classList.remove("deployment-error");
      hud.classList.add("hidden");
      deployPanel.classList.remove("hidden");
      deployTitle.textContent = "Deploying";
      deployStatus.textContent = message;
      deployStatus.classList.remove("error");
      deployRetry.classList.add("hidden");
      startStatus.textContent = message;
      startStatus.classList.remove("error");
      setStartBusy(true);
    },
    showStartError(message: string) {
      overlay.classList.remove("hidden");
      overlay.classList.add("deploying", "deployment-error");
      hud.classList.add("hidden");
      deployPanel.classList.remove("hidden");
      deployTitle.textContent = "Deployment Failed";
      deployStatus.textContent = message;
      deployStatus.classList.add("error");
      deployRetry.classList.remove("hidden");
      startStatus.textContent = message;
      startStatus.classList.add("error");
      startButton.textContent = "Retry";
      setStartBusy(false);
    },
    showGameOver(kills: number) {
      resetDeployPanel();
      overlay.classList.remove("hidden");
      hud.classList.add("hidden");
      overlay.querySelector("h1")!.textContent = "Signal Lost";
      overlay.querySelector("p")!.textContent =
        `The syndicate contained you after ${kills} confirmed kills. Redeploy to run the arena again.`;
      startStatus.textContent = "";
      startStatus.classList.remove("error");
      startButton.textContent = "Redeploy";
      setStartBusy(false);
    },
    showMainMenu() {
      resetDeployPanel();
      overlay.classList.remove("hidden");
      hud.classList.add("hidden");
      overlay.querySelector("h1")!.textContent = "Daemon Syndicate";
      overlay.querySelector("p")!.textContent =
        "Clear the alien-infested corporate black-site. Breach deeper, adapt fast, and survive whatever the syndicate buried below.";
      startStatus.textContent = "";
      startStatus.classList.remove("error");
      startButton.textContent = "Deploy";
      setStartBusy(false);
    },
    hideOverlay() {
      resetDeployPanel();
      overlay.classList.add("hidden");
      startStatus.textContent = "";
      startStatus.classList.remove("error");
      startButton.textContent = "Redeploy";
      setStartBusy(false);
    },
    setHudVisible(visible: boolean) {
      hud.classList.toggle("hidden", !visible);
    },
    setPaused(paused: boolean) {
      if (paused) showPauseView("main");
      pauseMenu.classList.toggle("hidden", !paused);
    },
    getStartMapDepth() {
      const mapDepth = Number(startMapDepth?.value ?? 1);
      return Number.isFinite(mapDepth) ? Math.max(1, Math.floor(mapDepth)) : 1;
    },
    setFpsVisible(visible: boolean) {
      fpsStat.classList.toggle("hidden", !visible);
    },
    updateFps(fps: number) {
      fpsValue.textContent = Math.round(fps).toString();
    },
    updateCameraDebug(angles: { pitchDegrees: number; yawDegrees: number }) {
      const pitch = angles.pitchDegrees.toFixed(1);
      const yaw = angles.yawDegrees.toFixed(1);
      cameraPitchValue.textContent = `${pitch} deg`;
      cameraYawValue.textContent = `${yaw} deg`;
      cameraDebugCopyValue = `pitch=${pitch} yaw=${yaw}`;
    },
    onAudioSettingsChange(listener: (settings: AudioSettings) => void) {
      audioSettingsListeners.push(listener);
      listener({ ...audioSettings });
    },
    onGraphicsSettingsChange(listener: (settings: GraphicsSettings) => void) {
      graphicsSettingsListeners.push(listener);
      listener({ ...graphicsSettings });
    },
    onCameraSettingsChange(listener: (settings: CameraSettings) => void) {
      cameraSettingsListeners.push(listener);
      listener({ ...cameraSettings });
    },
    updateHud(state: HudState) {
      const { resources, maxResources } = state;
      healthValue.textContent = `${Math.ceil(resources.health)}/${maxResources.health}`;
      ammoValue.textContent = `${Math.floor(resources.ammo)}/${maxResources.ammo}`;
      energyValue.textContent = `${Math.floor(resources.energy)}/${maxResources.energy}`;
      setMeter(healthMeter, resources.health, maxResources.health);
      setMeter(ammoMeter, resources.ammo, maxResources.ammo);
      setMeter(energyMeter, resources.energy, maxResources.energy);
      killsEl.textContent = state.kills.toString();
      mapDepthEl.textContent = state.mapDepth.toString();
      playerLevelEl.textContent = state.progression.level.toString();
      playerXpEl.textContent = `${state.progression.xp}/${state.progression.xpToNextLevel}`;
      primaryAbility.classList.toggle("disabled", !state.primaryReady);
      novaAbility.classList.toggle("disabled", !state.novaReady);
      dashAbility.classList.toggle("hidden", !state.dashUnlocked);
      dashAbility.classList.toggle("disabled", !state.dashReady);
      drawMinimap(minimap, state.minimap);
    },
    showUpgradeSelection(state, onSelect) {
      upgradeMenu.classList.remove("hidden");
      upgradePoints.textContent = `${state.points} ${state.points === 1 ? "point" : "points"}`;
      upgradeOptions.replaceChildren(
        ...state.options.map((option) => {
          const button = document.createElement("button");
          button.className = "upgrade-option";
          button.type = "button";
          button.dataset.upgradeId = option.id;
          button.innerHTML = `
            <span>
              <strong>${option.label}</strong>
              <em>Rank ${option.rank}/${option.maxRanks}</em>
            </span>
            <small>${option.description}</small>
          `;
          button.addEventListener("click", () => onSelect(option.id));
          return button;
        }),
      );
    },
    hideUpgradeSelection() {
      upgradeMenu.classList.add("hidden");
      upgradeOptions.replaceChildren();
    },
  };
}

const AUDIO_SETTINGS_STORAGE_KEY = "daemon-syndicate.audio-settings";

function drawMinimap(canvas: HTMLCanvasElement, state: HudState["minimap"]): void {
  const context = canvas.getContext("2d");
  if (!context) return;

  const size = canvas.width;
  const tileSize = size / MINIMAP_VIEW_TILES;
  const halfView = Math.floor(MINIMAP_VIEW_TILES / 2);
  const startX = state.playerTile.x - halfView;
  const startY = state.playerTile.y - halfView;
  context.clearRect(0, 0, size, size);
  context.fillStyle = "#020608";
  context.fillRect(0, 0, size, size);

  for (let localY = 0; localY < MINIMAP_VIEW_TILES; localY += 1) {
    for (let localX = 0; localX < MINIMAP_VIEW_TILES; localX += 1) {
      const tile = { x: startX + localX, y: startY + localY };
      const tileKey = key(tile);
      if (!state.explored.has(tileKey)) continue;

      context.fillStyle = "#4ec4bb";
      context.globalAlpha = 0.78;
      const x = Math.round(localX * tileSize);
      const y = Math.round(localY * tileSize);
      const width = Math.round((localX + 1) * tileSize) - x;
      const height = Math.round((localY + 1) * tileSize) - y;
      context.fillRect(x, y, width, height);
    }
  }
  context.globalAlpha = 1;

  drawMinimapWalls(context, state, startX, startY, tileSize);

  if (state.explored.has(key(state.level.end))) {
    drawMinimapExit(context, state.level.end.x - startX, state.level.end.y - startY, tileSize);
  }
  drawMinimapPlayer(context, size / 2, size / 2, state.playerRotation);
}

function drawMinimapWalls(
  context: CanvasRenderingContext2D,
  state: HudState["minimap"],
  startX: number,
  startY: number,
  tileSize: number,
): void {
  context.save();
  context.beginPath();
  context.strokeStyle = "#bafff6";
  context.globalAlpha = 0.92;
  context.lineWidth = 1;

  for (let localY = 0; localY < MINIMAP_VIEW_TILES; localY += 1) {
    for (let localX = 0; localX < MINIMAP_VIEW_TILES; localX += 1) {
      const tile = { x: startX + localX, y: startY + localY };
      if (!state.explored.has(key(tile))) continue;

      const left = Math.round(localX * tileSize) + 0.5;
      const top = Math.round(localY * tileSize) + 0.5;
      const right = Math.round((localX + 1) * tileSize) + 0.5;
      const bottom = Math.round((localY + 1) * tileSize) + 0.5;
      for (const edge of minimapWallEdges(state.level, tile)) {
        switch (edge) {
          case "north":
            context.moveTo(left, top);
            context.lineTo(right, top);
            break;
          case "east":
            context.moveTo(right, top);
            context.lineTo(right, bottom);
            break;
          case "south":
            context.moveTo(left, bottom);
            context.lineTo(right, bottom);
            break;
          case "west":
            context.moveTo(left, top);
            context.lineTo(left, bottom);
            break;
        }
      }
    }
  }
  context.stroke();
  context.restore();
}

function drawMinimapExit(context: CanvasRenderingContext2D, x: number, y: number, tileSize: number): void {
  context.save();
  context.fillStyle = "#ffd06a";
  context.shadowColor = "#ffd06a";
  context.shadowBlur = 5;
  const markerSize = Math.max(3, tileSize);
  context.fillRect(
    (x + 0.5) * tileSize - markerSize / 2,
    (y + 0.5) * tileSize - markerSize / 2,
    markerSize,
    markerSize,
  );
  context.restore();
}

function drawMinimapPlayer(context: CanvasRenderingContext2D, x: number, y: number, rotation: number): void {
  context.save();
  context.translate(x, y);
  context.rotate(-rotation);
  context.fillStyle = "#f5ffff";
  context.shadowColor = "#7afff1";
  context.shadowBlur = 7;
  context.beginPath();
  context.moveTo(0, -6);
  context.lineTo(4.5, 5);
  context.lineTo(0, 3.2);
  context.lineTo(-4.5, 5);
  context.closePath();
  context.fill();
  context.restore();
}

function loadAudioSettings(): AudioSettings {
  try {
    const stored = localStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY);
    if (!stored) return { ...DEFAULT_AUDIO_SETTINGS };
    const parsed = JSON.parse(stored) as Partial<AudioSettings>;
    return {
      muted: parsed.muted === true,
      masterVolume: clamp01(parsed.masterVolume ?? DEFAULT_AUDIO_SETTINGS.masterVolume),
      sfxVolume: clamp01(parsed.sfxVolume ?? DEFAULT_AUDIO_SETTINGS.sfxVolume),
    };
  } catch {
    return { ...DEFAULT_AUDIO_SETTINGS };
  }
}

function saveAudioSettings(settings: AudioSettings): void {
  try {
    localStorage.setItem(AUDIO_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Settings persistence is best-effort; audio should continue working without storage.
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value, 1));
}

function cameraViewFromDataset(value: string | undefined): CameraViewMode | undefined {
  return value === "depth" || value === "flat" ? value : undefined;
}

function renderScaleFromDataset(value: string | undefined): GraphicsSettings["renderScale"] | undefined {
  const scale = Number(value);
  return scale === 0.25 || scale === 0.5 || scale === 1 ? scale : undefined;
}

function pauseIconMarkup(icon: IconNode, className: string): string {
  return createElement(icon, {
    "aria-hidden": "true",
    class: `pause-icon ${className}`,
    height: 28,
    width: 28,
    "stroke-width": 2.25,
  }).outerHTML;
}
