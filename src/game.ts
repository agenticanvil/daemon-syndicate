import * as THREE from "three";
import { createThreeGameplayView, type GameplayView } from "./gameView";
import { GameSimulation, type DebugSpawnPosition } from "./gameSimulation";
import { InputState } from "./inputState";
import { movementInputFor } from "./movement";
import type { PerfRecorder } from "./perf";
import { idlePlayerCommand, type PlayerCommand } from "./playerCommand";
import type { Rng } from "./rng";
import type { GameScene } from "./scene";
import type { PlayerResources } from "./types";
import type { Ui } from "./ui";

type GameOptions = {
  rng?: Rng;
  seed?: string;
};

export type { DebugSpawnPosition };

export class Game {
  private readonly clock = new THREE.Clock();
  private readonly fpsFrameTimes: number[] = [];
  private readonly input = new InputState();
  private readonly view: GameplayView;
  private readonly simulation: GameSimulation;

  private fpsVisible = false;
  private nextFpsHudUpdateAt = 0;

  constructor(
    private readonly world: GameScene,
    private readonly ui: Ui,
    private readonly perf: PerfRecorder,
    options: GameOptions = {},
  ) {
    this.view = createThreeGameplayView(world);
    this.simulation = new GameSimulation(this.view, options);
  }

  bindEvents(): void {
    window.addEventListener("resize", this.world.resize);
    window.addEventListener("pointermove", this.updatePointerWorld);
    window.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("contextmenu", (event) => event.preventDefault());
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", (event) => this.input.deleteKey(event.code));
    this.ui.startButton.addEventListener("click", () => this.startNewRun());
    this.ui.resumeButton.addEventListener("click", () => this.setPaused(false));
  }

  startLoop(): void {
    this.animate();
  }

  startNewRun(): void {
    this.simulation.startNewRun();
    this.ui.hideOverlay();
    this.ui.setHudVisible(true);
    this.ui.setPaused(false);
    this.updateHud();
  }

  snapshot(): object {
    return this.simulation.snapshot();
  }

  spawnEnemy(kind: Parameters<GameSimulation["spawnEnemy"]>[0], position: DebugSpawnPosition): void {
    this.simulation.spawnEnemy(kind, position);
  }

  grantResources(resources: Partial<PlayerResources>): void {
    this.simulation.grantResources(resources);
    this.updateHud();
  }

  private readonly updatePointerWorld = (event: PointerEvent): void => {
    this.input.updatePointerFromEvent(event, this.world.camera, this.world.floor, this.world.reticle);
  };

  private updatePointerWorldFromCamera(): void {
    this.input.updatePointerWorldFromCamera(this.world.camera, this.world.floor, this.world.reticle);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.updatePointerWorld(event);
    if (!this.canAct()) return;
    if (event.button === 0) this.input.requestPrimaryFire();
    if (event.button === 2) this.input.requestNovaFire();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "KeyP") {
      if (!event.repeat) {
        this.fpsVisible = !this.fpsVisible;
        this.ui.setFpsVisible(this.fpsVisible);
        this.updateFpsHud(performance.now(), true);
      }
      return;
    }

    if (event.code === "Escape") {
      event.preventDefault();
      if (this.simulation.isStarted && !this.simulation.isGameOver) {
        this.setPaused(!this.simulation.isPaused);
      }
      return;
    }

    this.input.addKey(event.code);
    if (event.code === "Space") {
      event.preventDefault();
      if (this.canAct()) this.input.requestNovaFire();
    }
  };

  private canAct(): boolean {
    return this.simulation.isStarted && !this.simulation.isGameOver && !this.simulation.isPaused;
  }

  private setPaused(paused: boolean): void {
    this.simulation.setPaused(paused);
    this.ui.setPaused(paused);
  }

  private buildPlayerCommand(): PlayerCommand {
    if (!this.canAct()) {
      return idlePlayerCommand(this.simulation.playerPosition);
    }

    const strafe = (this.input.hasKey("KeyD") ? 1 : 0) - (this.input.hasKey("KeyA") ? 1 : 0);
    const forward = (this.input.hasKey("KeyW") ? 1 : 0) - (this.input.hasKey("KeyS") ? 1 : 0);
    return {
      movement: movementInputFor({
        mode: this.ui.getMovementMode(),
        camera: this.world.camera,
        pointerWorld: this.input.pointerWorld,
        playerPosition: this.simulation.playerPosition,
        playerYaw: this.simulation.playerRotationY,
        strafe,
        forward,
      }),
      aimWorld: this.input.pointerWorld.clone(),
      firePrimary: this.input.consumePrimaryFire(),
      fireNova: this.input.consumeNovaFire(),
    };
  }

  private updateCamera(): void {
    const offset = new THREE.Vector3(25, 26, 25);
    this.world.camera.position.copy(this.simulation.playerPosition).add(offset);
    this.world.camera.lookAt(this.simulation.playerPosition);
  }

  private updateHud(): void {
    this.ui.updateHud({
      resources: this.simulation.resources,
      maxResources: this.simulation.maxResources,
      kills: this.simulation.killCount,
      level: this.simulation.currentLevelNumber,
      primaryReady: this.simulation.primaryReady,
      novaReady: this.simulation.novaReady,
    });
  }

  private sampleFps(now: number): void {
    this.fpsFrameTimes.push(now);
    const cutoff = now - 2000;
    while (this.fpsFrameTimes.length > 0 && this.fpsFrameTimes[0] < cutoff) {
      this.fpsFrameTimes.shift();
    }
  }

  private updateFpsHud(now: number, force = false): void {
    if (!this.fpsVisible) return;
    if (!force && now < this.nextFpsHudUpdateAt) return;
    this.nextFpsHudUpdateAt = now + 250;

    const first = this.fpsFrameTimes[0];
    const last = this.fpsFrameTimes[this.fpsFrameTimes.length - 1];
    const elapsedSeconds = first === undefined || last === undefined ? 0 : (last - first) / 1000;
    const fps = elapsedSeconds > 0 ? (this.fpsFrameTimes.length - 1) / elapsedSeconds : 0;
    this.ui.updateFps(fps);
  }

  private perfFrameArgs(dt: number): Record<string, number | string | boolean> {
    return {
      dtMs: Math.round(dt * 100000) / 100,
      started: this.simulation.isStarted,
      paused: this.simulation.isPaused,
      gameOver: this.simulation.isGameOver,
      enemies: this.simulation.enemyCount,
      projectiles: this.simulation.projectileCount,
      pickups: this.simulation.pickupCount,
      damageTexts: this.simulation.damageTextCount,
      novaMeshes: this.simulation.novaCount,
      level: this.simulation.currentLevelNumber,
      wave: this.simulation.currentWave,
      kills: this.simulation.killCount,
      renderCalls: this.world.renderer.info.render.calls,
      triangles: this.world.renderer.info.render.triangles,
      geometries: this.world.renderer.info.memory.geometries,
      textures: this.world.renderer.info.memory.textures,
    };
  }

  private readonly animate = (): void => {
    requestAnimationFrame(this.animate);
    const now = performance.now();
    this.sampleFps(now);
    this.updateFpsHud(now);
    const dt = Math.min(this.clock.getDelta(), 0.033);

    this.perf.frame(this.perfFrameArgs(dt), () => {
      const command = this.buildPlayerCommand();
      if (this.simulation.isStarted && !this.simulation.isGameOver && !this.simulation.isPaused) {
        this.perf.span("simulation.step", () => this.simulation.step(dt, command));
        this.perf.span("camera", () => this.updateCamera());
        this.perf.span("pointer.world", () => this.updatePointerWorldFromCamera());
        this.perf.span("hud/dom", () => this.updateHud());
        if (this.simulation.isGameOver) {
          this.ui.showGameOver(this.simulation.killCount);
        }
      }

      if (!this.simulation.isStarted || this.simulation.isGameOver || this.simulation.isPaused) {
        this.perf.span("camera", () => this.updateCamera());
      }
      this.perf.span("three.render.cpu", () => this.world.renderer.render(this.world.scene, this.world.camera));
    });
  };
}
