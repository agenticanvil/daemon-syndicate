import { DEFAULT_AUDIO_SETTINGS, type AudioSettings } from "./audio";
import type { PlayerResources } from "./types";
import type { GraphicsSettings } from "./scene";
import type { UpgradeId, UpgradeOption } from "./upgrades";

export type MovementControlMode = "isometric" | "screen" | "mouse";

type HudState = {
  resources: PlayerResources;
  maxResources: PlayerResources;
  kills: number;
  mapLevel: number;
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
};

export type Ui = {
  startButton: HTMLButtonElement;
  resumeButton: HTMLButtonElement;
  overlay: HTMLDivElement;
  pauseMenu: HTMLDivElement;
  showGameOver: (kills: number) => void;
  hideOverlay: () => void;
  setHudVisible: (visible: boolean) => void;
  setPaused: (paused: boolean) => void;
  getStartMapLevel: () => number;
  getMovementMode: () => MovementControlMode;
  setFpsVisible: (visible: boolean) => void;
  updateFps: (fps: number) => void;
  onAudioSettingsChange: (listener: (settings: AudioSettings) => void) => void;
  onGraphicsSettingsChange: (listener: (settings: GraphicsSettings) => void) => void;
  updateHud: (state: HudState) => void;
  showUpgradeSelection: (state: { points: number; options: UpgradeOption[] }, onSelect: (id: UpgradeId) => void) => void;
  hideUpgradeSelection: () => void;
};

export function createUi(app: HTMLDivElement): Ui {
  app.innerHTML = `
    <div class="overlay" id="overlay">
      <div class="start">
        <h1>Daemon Syndicate</h1>
        <p>Clear the corporate black-site. Manage health, ammunition, and energy while escalating incursions close in.</p>
        <div class="start-actions">
          <label class="start-level">
            <span>Start Map</span>
            <select id="startMapLevel">
              ${Array.from({ length: 10 }, (_, index) => {
                const level = index + 1;
                return `<option value="${level}">${level}</option>`;
              }).join("")}
            </select>
          </label>
          <button id="start">Deploy</button>
        </div>
      </div>
    </div>
    <div class="hud hidden">
      <div class="topbar">
        <div class="resource-stack">
          <div class="resource health">
            <div class="resource-head"><span>Health</span><strong id="healthValue">100</strong></div>
            <div class="meter"><i id="healthMeter"></i></div>
          </div>
          <div class="resource ammo">
            <div class="resource-head"><span>Ammo</span><strong id="ammoValue">80</strong></div>
            <div class="meter"><i id="ammoMeter"></i></div>
          </div>
          <div class="resource energy">
            <div class="resource-head"><span>Energy</span><strong id="energyValue">100</strong></div>
            <div class="meter"><i id="energyMeter"></i></div>
          </div>
        </div>
        <div class="stats">
          <div class="stat"><span>Kills</span><strong id="kills">0</strong></div>
          <div class="stat"><span>Map</span><strong id="mapLevel">1</strong></div>
          <div class="stat"><span>Rank</span><strong id="playerLevel">1</strong></div>
          <div class="stat"><span>XP</span><strong id="playerXp">0/100</strong></div>
          <div class="stat fps-stat hidden" id="fpsStat"><span>FPS</span><strong id="fpsValue">0</strong></div>
        </div>
      </div>
      <div class="ability-bar">
        <div class="ability" id="primaryAbility"><strong>LMB</strong><span>Bolt</span><em>Ammo</em></div>
        <div class="ability" id="novaAbility"><strong>RMB</strong><span>Nova</span><em>Energy</em></div>
        <div class="ability hidden" id="dashAbility"><strong>Shift</strong><span>Dash</span><em>Energy</em></div>
      </div>
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
            <span class="pause-icon icon-continue" aria-hidden="true"></span>
            <span>Continue</span>
          </button>
          <button class="pause-option" id="settingsButton">
            <span class="pause-icon icon-settings" aria-hidden="true"></span>
            <span>Settings</span>
          </button>
          <button class="pause-option" id="helpButton">
            <span class="pause-icon icon-help" aria-hidden="true"></span>
            <span>Help</span>
          </button>
        </nav>
        <section class="pause-view pause-view-settings" aria-label="Settings">
          <button class="pause-back" id="settingsBack" type="button">Back</button>
          <div class="pause-section">
            <h3>Controls</h3>
            <div class="setting-row">
              <div>
                <span class="setting-label">Movement</span>
              </div>
              <div class="movement-options" role="group" aria-label="Movement">
                <button class="movement-option" type="button" aria-pressed="false" data-movement-mode="isometric">Isometric WASD</button>
                <button class="movement-option selected" type="button" aria-pressed="true" data-movement-mode="screen">Screen WASD</button>
                <button class="movement-option" type="button" aria-pressed="false" data-movement-mode="mouse">Mouse WASD</button>
              </div>
            </div>
          </div>
          <div class="pause-section">
            <h3>Graphics</h3>
            <label class="setting-row setting-toggle">
              <span class="setting-label">Preserve buffer</span>
              <input id="preserveDrawingBuffer" type="checkbox" checked />
            </label>
            <div class="setting-row">
              <div>
                <span class="setting-label">Pixel ratio</span>
              </div>
              <div class="graphics-options" role="group" aria-label="Pixel ratio">
                <button class="graphics-pixel-option" type="button" aria-pressed="false" data-pixel-ratio="1">1</button>
                <button class="graphics-pixel-option" type="button" aria-pressed="false" data-pixel-ratio="1.5">1.5</button>
                <button class="graphics-pixel-option selected" type="button" aria-pressed="true" data-pixel-ratio="2">2</button>
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
            <div><dt>Gate</dt><dd>Reach the glowing exit to generate the next level</dd></div>
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
  const startMapLevel = document.querySelector<HTMLSelectElement>("#startMapLevel")!;
  const resumeButton = document.querySelector<HTMLButtonElement>("#resume")!;
  const settingsButton = document.querySelector<HTMLButtonElement>("#settingsButton")!;
  const helpButton = document.querySelector<HTMLButtonElement>("#helpButton")!;
  const settingsBack = document.querySelector<HTMLButtonElement>("#settingsBack")!;
  const helpBack = document.querySelector<HTMLButtonElement>("#helpBack")!;
  const healthValue = document.querySelector<HTMLElement>("#healthValue")!;
  const ammoValue = document.querySelector<HTMLElement>("#ammoValue")!;
  const energyValue = document.querySelector<HTMLElement>("#energyValue")!;
  const healthMeter = document.querySelector<HTMLElement>("#healthMeter")!;
  const ammoMeter = document.querySelector<HTMLElement>("#ammoMeter")!;
  const energyMeter = document.querySelector<HTMLElement>("#energyMeter")!;
  const killsEl = document.querySelector<HTMLElement>("#kills")!;
  const mapLevelEl = document.querySelector<HTMLElement>("#mapLevel")!;
  const playerLevelEl = document.querySelector<HTMLElement>("#playerLevel")!;
  const playerXpEl = document.querySelector<HTMLElement>("#playerXp")!;
  const fpsStat = document.querySelector<HTMLElement>("#fpsStat")!;
  const fpsValue = document.querySelector<HTMLElement>("#fpsValue")!;
  const primaryAbility = document.querySelector<HTMLElement>("#primaryAbility")!;
  const novaAbility = document.querySelector<HTMLElement>("#novaAbility")!;
  const dashAbility = document.querySelector<HTMLElement>("#dashAbility")!;
  const movementOptions = Array.from(pausePanel.querySelectorAll<HTMLButtonElement>(".movement-option"));
  const preserveDrawingBuffer = document.querySelector<HTMLInputElement>("#preserveDrawingBuffer")!;
  const pixelRatioOptions = Array.from(pausePanel.querySelectorAll<HTMLButtonElement>(".graphics-pixel-option"));
  const audioMuted = document.querySelector<HTMLInputElement>("#audioMuted")!;
  const masterVolume = document.querySelector<HTMLInputElement>("#masterVolume")!;
  const masterVolumeValue = document.querySelector<HTMLElement>("#masterVolumeValue")!;
  const sfxVolume = document.querySelector<HTMLInputElement>("#sfxVolume")!;
  const sfxVolumeValue = document.querySelector<HTMLElement>("#sfxVolumeValue")!;
  let movementMode: MovementControlMode = "screen";
  let graphicsSettings: GraphicsSettings = {
    preserveDrawingBuffer: preserveDrawingBuffer.checked,
    pixelRatio: 2,
  };
  let audioSettings = loadAudioSettings();
  const graphicsSettingsListeners: Array<(settings: GraphicsSettings) => void> = [];
  const audioSettingsListeners: Array<(settings: AudioSettings) => void> = [];

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

  movementOptions.forEach((option) => {
    option.addEventListener("click", () => {
      const nextMode = option.dataset.movementMode;
      if (nextMode !== "isometric" && nextMode !== "screen" && nextMode !== "mouse") return;
      movementMode = nextMode;

      movementOptions.forEach((button) => {
        const selected = button === option;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", selected.toString());
      });
    });
  });
  preserveDrawingBuffer.addEventListener("change", () => {
    graphicsSettings = {
      ...graphicsSettings,
      preserveDrawingBuffer: preserveDrawingBuffer.checked,
    };
    emitGraphicsSettings();
  });
  pixelRatioOptions.forEach((option) => {
    option.addEventListener("click", () => {
      const nextPixelRatio = Number(option.dataset.pixelRatio);
      if (nextPixelRatio !== 1 && nextPixelRatio !== 1.5 && nextPixelRatio !== 2) return;
      graphicsSettings = {
        ...graphicsSettings,
        pixelRatio: nextPixelRatio,
      };

      pixelRatioOptions.forEach((button) => {
        const selected = button === option;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", selected.toString());
      });
      emitGraphicsSettings();
    });
  });
  audioMuted.addEventListener("change", () => {
    audioSettings = { ...audioSettings, muted: audioMuted.checked };
    emitAudioSettings();
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
    overlay,
    pauseMenu,
    showGameOver(kills: number) {
      overlay.classList.remove("hidden");
      hud.classList.add("hidden");
      overlay.querySelector("h1")!.textContent = "Signal Lost";
      overlay.querySelector("p")!.textContent =
        `The syndicate contained you after ${kills} confirmed kills. Redeploy to run the arena again.`;
      startButton.textContent = "Redeploy";
    },
    hideOverlay() {
      overlay.classList.add("hidden");
    },
    setHudVisible(visible: boolean) {
      hud.classList.toggle("hidden", !visible);
    },
    setPaused(paused: boolean) {
      if (paused) showPauseView("main");
      pauseMenu.classList.toggle("hidden", !paused);
    },
    getStartMapLevel() {
      const mapLevel = Number(startMapLevel.value);
      return Number.isFinite(mapLevel) ? Math.max(1, Math.floor(mapLevel)) : 1;
    },
    getMovementMode() {
      return movementMode;
    },
    setFpsVisible(visible: boolean) {
      fpsStat.classList.toggle("hidden", !visible);
    },
    updateFps(fps: number) {
      fpsValue.textContent = Math.round(fps).toString();
    },
    onAudioSettingsChange(listener: (settings: AudioSettings) => void) {
      audioSettingsListeners.push(listener);
      listener({ ...audioSettings });
    },
    onGraphicsSettingsChange(listener: (settings: GraphicsSettings) => void) {
      graphicsSettingsListeners.push(listener);
      listener({ ...graphicsSettings });
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
      mapLevelEl.textContent = state.mapLevel.toString();
      playerLevelEl.textContent = state.progression.level.toString();
      playerXpEl.textContent = `${state.progression.xp}/${state.progression.xpToNextLevel}`;
      primaryAbility.classList.toggle("disabled", !state.primaryReady);
      novaAbility.classList.toggle("disabled", !state.novaReady);
      dashAbility.classList.toggle("hidden", !state.dashUnlocked);
      dashAbility.classList.toggle("disabled", !state.dashReady);
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
