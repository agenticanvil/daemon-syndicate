import type { PlayerResources } from "./types";

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
      <div class="pause-panel">
        <div class="pause-head">
          <h2 id="pauseTitle">Paused</h2>
          <button id="resume">Resume</button>
        </div>
        <section>
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
  const startButton = document.querySelector<HTMLButtonElement>("#start")!;
  const resumeButton = document.querySelector<HTMLButtonElement>("#resume")!;
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

  function setMeter(el: HTMLElement, value: number, max: number): void {
    el.style.width = `${Math.max(0, Math.min(value / max, 1)) * 100}%`;
  }

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
      pauseMenu.classList.toggle("hidden", !paused);
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
