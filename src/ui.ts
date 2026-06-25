import type { PlayerResources } from "./types";

export type MovementControlMode = "isometric" | "screen" | "mouse";

export type HudState = {
  resources: PlayerResources;
  maxResources: PlayerResources;
  kills: number;
  level: number;
  primaryReady: boolean;
  novaReady: boolean;
};

export type Ui = {
  startButton: HTMLButtonElement;
  resumeButton: HTMLButtonElement;
  overlay: HTMLDivElement;
  pauseMenu: HTMLDivElement;
  showStart: () => void;
  showGameOver: (kills: number) => void;
  hideOverlay: () => void;
  setPaused: (paused: boolean) => void;
  getMovementMode: () => MovementControlMode;
  updateHud: (state: HudState) => void;
};

export function createUi(app: HTMLDivElement): Ui {
  app.innerHTML = `
    <div class="overlay" id="overlay">
      <div class="start">
        <h1>Daemon Syndicate</h1>
        <p>Clear the corporate black-site. Manage health, ammunition, and energy while escalating incursions close in.</p>
        <button id="start">Deploy</button>
      </div>
    </div>
    <div class="hud">
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
          <div class="stat"><span>Level</span><strong id="level">1</strong></div>
        </div>
      </div>
      <div class="ability-bar">
        <div class="ability" id="primaryAbility"><strong>LMB</strong><span>Bolt</span><em>Ammo</em></div>
        <div class="ability" id="novaAbility"><strong>RMB</strong><span>Nova</span><em>Energy</em></div>
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
            <div class="empty-section" aria-hidden="true"></div>
          </div>
          <div class="pause-section">
            <h3>Audio</h3>
            <div class="empty-section" aria-hidden="true"></div>
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
  `;

  const overlay = document.querySelector<HTMLDivElement>("#overlay")!;
  const pauseMenu = document.querySelector<HTMLDivElement>("#pauseMenu")!;
  const pausePanel = document.querySelector<HTMLDivElement>(".pause-panel")!;
  const startButton = document.querySelector<HTMLButtonElement>("#start")!;
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
  const levelEl = document.querySelector<HTMLElement>("#level")!;
  const primaryAbility = document.querySelector<HTMLElement>("#primaryAbility")!;
  const novaAbility = document.querySelector<HTMLElement>("#novaAbility")!;
  const movementOptions = Array.from(pausePanel.querySelectorAll<HTMLButtonElement>(".movement-option"));
  let movementMode: MovementControlMode = "screen";

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

  return {
    startButton,
    resumeButton,
    overlay,
    pauseMenu,
    showStart() {
      overlay.classList.remove("hidden");
      overlay.querySelector("h1")!.textContent = "Daemon Syndicate";
      overlay.querySelector("p")!.textContent =
        "Clear the corporate black-site. Manage health, ammunition, and energy while escalating incursions close in.";
      startButton.textContent = "Deploy";
    },
    showGameOver(kills: number) {
      overlay.classList.remove("hidden");
      overlay.querySelector("h1")!.textContent = "Signal Lost";
      overlay.querySelector("p")!.textContent =
        `The syndicate contained you after ${kills} confirmed kills. Redeploy to run the arena again.`;
      startButton.textContent = "Redeploy";
    },
    hideOverlay() {
      overlay.classList.add("hidden");
    },
    setPaused(paused: boolean) {
      if (paused) showPauseView("main");
      pauseMenu.classList.toggle("hidden", !paused);
    },
    getMovementMode() {
      return movementMode;
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
      levelEl.textContent = state.level.toString();
      primaryAbility.classList.toggle("disabled", !state.primaryReady);
      novaAbility.classList.toggle("disabled", !state.novaReady);
    },
  };
}
