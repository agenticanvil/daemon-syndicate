import * as THREE from "three";
import type { GameAudio } from "./audio";
import { TILE_SIZE } from "./constants";
import { EntityViewSync } from "./entityViewSync";
import { FixedStepClock } from "./fixedStepClock";
import type { GameEffect } from "./gameEffects";
import { GameAudioFeedback } from "./gameAudioFeedback";
import { GameplayCameraController } from "./gameCamera";
import { HudPresenter } from "./gameHud";
import { createThreeGameplayView, type GameplayEffectAssets, type GameplayView } from "./gameView";
import { GameSimulation, type DebugSpawnPosition, type GameSimulationSnapshot, type GameStepResult } from "./gameSimulation";
import { InputState } from "./inputState";
import type { PerfRecorder } from "./perf";
import { PlayerCommandBuilder } from "./playerCommandBuilder";
import type { Rng } from "./rng";
import type { GameScene } from "./scene";
import type { PlayerResources } from "./resourceTypes";
import { DEFAULT_CAMERA_SETTINGS, type Ui } from "./ui";
import type { UpgradeId } from "./upgrades";

type GameOptions = {
  audio?: GameAudio;
  effectAssets?: GameplayEffectAssets;
  rng?: Rng;
  seed?: string;
};

const CAMERA_PITCH_KEY = "KeyI";
const CAMERA_YAW_KEY = "KeyO";

export type { DebugSpawnPosition };

export class Game {
  private readonly clock = new THREE.Clock();
  private readonly fpsFrameTimes: number[] = [];
  private readonly input = new InputState();
  private readonly simulationClock = new FixedStepClock();
  private readonly view: GameplayView;
  private readonly simulation: GameSimulation;
  private readonly entityViews: EntityViewSync;
  private readonly camera: GameplayCameraController;
  private readonly audioFeedback: GameAudioFeedback;
  private readonly hud: HudPresenter;
  private readonly commandBuilder: PlayerCommandBuilder;
  private readonly eventDisposers: Array<() => void> = [];

  private fpsVisible = false;
  private minimapVisible = true;
  private nextFpsHudUpdateAt = 0;
  private selectingUpgrade = false;
  private animationFrameId: number | undefined;

  constructor(
    private readonly world: GameScene,
    private readonly ui: Ui,
    private readonly perf: PerfRecorder,
    options: GameOptions = {},
  ) {
    this.view = createThreeGameplayView(world, options.effectAssets);
    this.entityViews = new EntityViewSync(this.view);
    this.simulation = new GameSimulation(options);
    this.camera = new GameplayCameraController(() => world.camera, () => world.cameraView, DEFAULT_CAMERA_SETTINGS);
    this.audioFeedback = new GameAudioFeedback(options.audio);
    this.hud = new HudPresenter(ui);
    this.commandBuilder = new PlayerCommandBuilder(this.input, () => world.camera);
    this.ui.onCameraSettingsChange((settings) => {
      this.camera.setSettings(settings);
    });
    this.ui.onDebugInvulnerabilityChange((enabled) => {
      this.simulation.setDebugInvulnerable(enabled);
    });
    this.resetViewForSimulation();
  }

  bindEvents(): void {
    this.addWindowListener("resize", this.world.resize);
    this.addWindowListener("pointermove", this.updatePointerWorld);
    this.addWindowListener("pointerdown", this.handlePointerDown);
    this.addWindowListener("contextmenu", this.preventContextMenu);
    this.addWindowListener("keydown", this.handleKeyDown);
    this.addWindowListener("keyup", this.handleKeyUp);
    const handleResumeClick = (): void => this.setPaused(false);
    const handleMainMenuClick = (): void => this.exitToMainMenu();
    this.ui.resumeButton.addEventListener("click", handleResumeClick);
    this.ui.mainMenuButton.addEventListener("click", handleMainMenuClick);
    this.eventDisposers.push(() => this.ui.resumeButton.removeEventListener("click", handleResumeClick));
    this.eventDisposers.push(() => this.ui.mainMenuButton.removeEventListener("click", handleMainMenuClick));
  }

  async prepare(): Promise<void> {
    this.world.updatePlayerLocalAmbient(this.simulation.playerPosition);
    this.world.updateGameplayLighting(this.simulation.playerPosition, 0);
    this.world.updateWallOcclusion(this.simulation.playerPosition, this.world.camera, 0, true);
    await this.view.warmUp();
  }

  startLoop(): void {
    if (this.animationFrameId !== undefined) return;
    this.animate();
  }

  dispose(): void {
    if (this.animationFrameId !== undefined) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }
    for (const dispose of this.eventDisposers.splice(0)) {
      dispose();
    }
    this.entityViews.clear();
    this.view.dispose();
    this.audioFeedback.stopEnemyMovement();
  }

  startNewRun(mapDepth = 1): void {
    this.simulationClock.reset();
    this.simulation.startNewRun({ mapDepth });
    this.selectingUpgrade = false;
    this.resetViewForSimulation();
    this.ui.hideOverlay();
    this.ui.hideUpgradeSelection();
    this.ui.setHudVisible(true);
    this.ui.setPaused(false);
    this.hud.update(this.simulation);
    this.audioFeedback.playStartRun();
  }

  snapshot(): GameSimulationSnapshot {
    return this.simulation.snapshot();
  }

  spawnEnemy(kind: Parameters<GameSimulation["spawnEnemy"]>[0], position: DebugSpawnPosition): void {
    this.simulation.spawnEnemy(kind, position);
  }

  grantResources(resources: Partial<PlayerResources>): void {
    this.simulation.grantResources(resources);
    this.hud.update(this.simulation);
  }

  private readonly updatePointerWorld = (event: PointerEvent): void => {
    this.input.updatePointerFromEvent(event, this.world.camera, this.world.floor, this.world.reticle);
  };

  private updatePointerWorldFromCamera(): void {
    this.input.updatePointerWorldFromCamera(this.world.camera, this.world.floor, this.world.reticle);
  }

  private addWindowListener<K extends keyof WindowEventMap>(
    type: K,
    listener: (event: WindowEventMap[K]) => void,
  ): void {
    window.addEventListener(type, listener as EventListener);
    this.eventDisposers.push(() => window.removeEventListener(type, listener as EventListener));
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.audioFeedback.unlock();
    this.updatePointerWorld(event);
    if (!this.canAct()) return;
    if (event.button === 0) this.input.requestPrimaryFire();
    if (event.button === 2) this.input.requestNovaFire();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    this.audioFeedback.unlock();
    if (event.code === "KeyP") {
      if (!event.repeat) {
        this.fpsVisible = !this.fpsVisible;
        this.ui.setFpsVisible(this.fpsVisible);
        this.updateFpsHud(performance.now(), true);
      }
      return;
    }

    if (event.code === "KeyM") {
      event.preventDefault();
      if (!event.repeat) {
        this.minimapVisible = !this.minimapVisible;
        this.ui.setMinimapVisible(this.minimapVisible);
      }
      return;
    }

    if (event.code === "Escape") {
      event.preventDefault();
      if (this.selectingUpgrade) return;
      if (this.simulation.isStarted && !this.simulation.isGameOver) {
        this.setPaused(!this.simulation.isPaused);
      }
      return;
    }

    this.input.addKey(event.code);
    if (event.code === CAMERA_PITCH_KEY || event.code === CAMERA_YAW_KEY) {
      event.preventDefault();
    }
    if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
      event.preventDefault();
      if (this.canAct()) this.input.requestDash();
    }
    if (event.code === "Space") {
      event.preventDefault();
      if (this.canAct()) this.input.requestNovaFire();
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.input.deleteKey(event.code);
  };

  private readonly preventContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private canAct(): boolean {
    return this.simulation.isStarted && !this.simulation.isGameOver && !this.simulation.isPaused;
  }

  private setPaused(paused: boolean): void {
    const changed = this.simulation.isPaused !== paused;
    this.simulation.setPaused(paused);
    if (paused) this.simulationClock.reset();
    this.ui.setPaused(paused);
    if (changed) {
      this.audioFeedback.playPauseChanged(paused);
    }
  }

  private exitToMainMenu(): void {
    this.selectingUpgrade = false;
    this.simulationClock.reset();
    this.simulation.exitToMainMenu();
    this.input.clear();
    this.resetViewForSimulation();
    this.ui.hideUpgradeSelection();
    this.ui.setPaused(false);
    this.ui.setHudVisible(false);
    this.ui.showMainMenu();
  }

  private presentUpgradeSelection(): void {
    const progression = this.simulation.progressionHudState;
    const options = this.simulation.availableUpgrades;
    if (progression.unspentUpgradePoints <= 0 || options.length === 0) {
      this.selectingUpgrade = false;
      this.ui.hideUpgradeSelection();
      this.simulation.setPaused(false);
      return;
    }

    this.selectingUpgrade = true;
    this.simulation.setPaused(true);
    this.ui.showUpgradeSelection(
      {
        points: progression.unspentUpgradePoints,
        options,
      },
      this.handleUpgradeSelected,
    );
  }

  private readonly handleUpgradeSelected = (id: UpgradeId): void => {
    if (!this.selectingUpgrade) return;
    if (this.simulation.spendUpgrade(id)) {
      this.hud.update(this.simulation);
      this.audioFeedback.playUpgradeSelected();
    }
    this.presentUpgradeSelection();
  };

  private applyStepEffects(effects: readonly GameEffect[]): void {
    for (const effect of effects) {
      switch (effect.type) {
        case "damageText":
          this.view.spawnDamageText(effect.position, effect.text);
          break;
        case "enemyHit":
          this.view.flashEnemy(effect.enemyId);
          break;
        case "enemyDeath":
          this.view.spawnEnemyDeath(effect.position);
          break;
        case "nova":
          this.view.spawnNova(effect.position, effect.radius);
          break;
        case "projectileImpact":
          this.view.spawnProjectileImpact(effect.position, effect.incomingVelocity);
          break;
        case "playerDamaged":
          this.view.showPlayerDamage(effect.amount);
          break;
      }
    }
  }

  private buildPlayerCommand() {
    return this.commandBuilder.build({
      canAct: this.canAct(),
      playerPosition: this.simulation.playerPosition,
      playerRotationY: this.simulation.playerRotationY,
    });
  }

  private resetViewForSimulation(): void {
    this.audioFeedback.stopEnemyMovement();
    this.entityViews.clear();
    this.view.clearEffects();
    this.view.renderLevel(this.simulation.level);
    this.view.resetReticle(this.simulation.playerPosition.clone().add(new THREE.Vector3(0, 0, -TILE_SIZE)));
    this.camera.reset(this.simulation.playerPosition);
    this.camera.update(0, this.simulation.playerPosition, this.input.pointerWorld, true);
    this.syncView(0, true);
  }

  private syncView(dt: number, instantPlayer = false): void {
    this.view.syncPlayer(this.simulation.playerRenderState(), dt, instantPlayer);
    this.entityViews.sync(this.simulation.entityState(), dt);
    this.view.updateEffects(dt);
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
    this.ui.updateCameraDebug(this.camera.cameraAngles());
  }

  private updateCameraOrbitFromInput(dt: number): void {
    const reverse = this.input.hasKey("ShiftLeft") || this.input.hasKey("ShiftRight");
    const direction = reverse ? -1 : 1;
    const pitch = this.input.hasKey(CAMERA_PITCH_KEY) ? direction : 0;
    const yaw = this.input.hasKey(CAMERA_YAW_KEY) ? direction : 0;
    if (pitch !== 0 || yaw !== 0) {
      this.camera.adjustOrbit(pitch, yaw, dt);
      this.ui.updateCameraDebug(this.camera.cameraAngles());
    }
  }

  private perfFrameArgs(dt: number): Record<string, number | string | boolean> {
    const effects = this.view.snapshotEffects();
    return {
      dtMs: Math.round(dt * 100000) / 100,
      started: this.simulation.isStarted,
      paused: this.simulation.isPaused,
      gameOver: this.simulation.isGameOver,
      enemies: this.simulation.enemyCount,
      projectiles: this.simulation.projectileCount,
      pickups: this.simulation.pickupCount,
      damageTexts: effects.damageTexts.length,
      novaMeshes: effects.novaMeshes.length,
      enemyDeathParticles: effects.enemyDeathParticles.length,
      enemyDeathDecals: effects.enemyDeathDecals.length,
      mapDepth: this.simulation.currentMapDepth,
      kills: this.simulation.killCount,
      renderCalls: this.world.renderer.info.render.calls,
      triangles: this.world.renderer.info.render.triangles,
      geometries: this.world.renderer.info.memory.geometries,
      textures: this.world.renderer.info.memory.textures,
    };
  }

  private runFrame(dt: number): void {
    this.updateCameraOrbitFromInput(dt);
    if (this.simulation.isStarted && !this.simulation.isGameOver && !this.simulation.isPaused) {
      this.simulationClock.advance(dt, (fixedDt) => {
        if (!this.canAct()) return;
        const result = this.simulation.step(fixedDt, this.buildPlayerCommand());
        this.applySimulationResult(result, fixedDt);
      });
    } else {
      this.simulationClock.reset();
    }

    if (!this.simulation.isStarted || this.simulation.isGameOver || this.simulation.isPaused) {
      this.syncView(dt);
      this.audioFeedback.stopEnemyMovement();
      this.camera.update(dt, this.simulation.playerPosition, this.input.pointerWorld);
    }
    this.world.updatePlayerLocalAmbient(this.simulation.playerPosition);
    this.world.updateGameplayLighting(this.simulation.playerPosition, dt);
    this.world.updateWallOcclusion(this.simulation.playerPosition, this.world.camera, dt);
    this.world.render();
  }

  private runInstrumentedFrame(dt: number): void {
    this.updateCameraOrbitFromInput(dt);
    if (this.simulation.isStarted && !this.simulation.isGameOver && !this.simulation.isPaused) {
      this.simulationClock.advance(dt, (fixedDt) => {
        if (!this.canAct()) return;
        const result = this.perf.span("simulation.step", () =>
          this.simulation.step(fixedDt, this.buildPlayerCommand()),
        );
        this.applySimulationResult(result, fixedDt);
      });
    } else {
      this.simulationClock.reset();
    }

    if (!this.simulation.isStarted || this.simulation.isGameOver || this.simulation.isPaused) {
      this.syncView(dt);
      this.audioFeedback.stopEnemyMovement();
      this.perf.span("camera", () => this.camera.update(dt, this.simulation.playerPosition, this.input.pointerWorld));
    }
    this.world.updatePlayerLocalAmbient(this.simulation.playerPosition);
    this.world.updateGameplayLighting(this.simulation.playerPosition, dt);
    this.world.updateWallOcclusion(this.simulation.playerPosition, this.world.camera, dt);
    this.perf.span("three.render.cpu", () => this.world.render());
  }

  private applySimulationResult(result: GameStepResult, dt: number): void {
    if (result.mapDepthChanged) {
      this.resetViewForSimulation();
    }
    if (result.primaryFired) {
      this.view.triggerPlayerFire();
    }
    this.camera.applyFeedback(result);
    this.applyStepEffects(result.effects);
    this.syncView(dt, result.mapDepthChanged);
    this.audioFeedback.playStep(result);
    this.audioFeedback.updateEnemyMovement(this.simulation.playerPosition, this.simulation.entityState().enemies);
    if (this.perf.enabled) {
      this.perf.span("camera", () =>
        this.camera.update(dt, this.simulation.playerPosition, this.input.pointerWorld, result.mapDepthChanged),
      );
      this.perf.span("pointer.world", () => this.updatePointerWorldFromCamera());
      this.perf.span("hud/dom", () => this.hud.update(this.simulation));
    } else {
      this.camera.update(dt, this.simulation.playerPosition, this.input.pointerWorld, result.mapDepthChanged);
      this.updatePointerWorldFromCamera();
      this.hud.update(this.simulation);
    }
    if (this.simulation.isGameOver) {
      this.ui.showGameOver(this.simulation.killCount);
    } else if (result.mapDepthChanged) {
      this.presentUpgradeSelection();
    }
  }

  private readonly animate = (): void => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    const now = performance.now();
    this.sampleFps(now);
    this.updateFpsHud(now);
    const dt = this.clock.getDelta();

    if (this.perf.enabled) {
      this.perf.frame(this.perfFrameArgs(dt), () => this.runInstrumentedFrame(dt));
    } else {
      this.runFrame(dt);
    }
  };
}
