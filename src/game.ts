import * as THREE from "three";
import { PLAYER_BALANCE } from "./balance";
import { distance2D, type CollisionBody2D, type CollisionLayer } from "./collision";
import { PLAYER_MAX, TILE_SIZE } from "./constants";
import { CombatSystem } from "./combatSystem";
import { EffectsSystem } from "./effectsSystem";
import { EnemySystem } from "./enemySystem";
import { EventQueue, type GameEvent } from "./eventQueue";
import { InputState } from "./inputState";
import { exitGateToWorld, generateLevel, tileToWorld, type LevelData } from "./level";
import { movementInputFor, moveOnWalkableLevel } from "./movement";
import type { PerfRecorder } from "./perf";
import { PickupSystem } from "./pickupSystem";
import type { GameScene } from "./scene";
import { hasStatusEffect, setStatusEffect, tickStatusEffects, type StatusEffect } from "./statusEffects";
import type { Ui } from "./ui";
import type { PlayerResources } from "./types";

const PLAYER_MODEL_FORWARD_OFFSET = Math.PI;

export class Game {
  private readonly clock = new THREE.Clock();
  private readonly fpsFrameTimes: number[] = [];
  private readonly input = new InputState();
  private readonly maxResources: PlayerResources = { ...PLAYER_MAX };
  private readonly movementInput = new THREE.Vector3();
  private readonly playerCollisionBody: CollisionBody2D;
  private readonly effects: EffectsSystem;
  private readonly events = new EventQueue();
  private readonly pickups: PickupSystem;
  private readonly enemies: EnemySystem;
  private readonly combat: CombatSystem;

  private resources: PlayerResources = { ...PLAYER_MAX };
  private started = false;
  private paused = false;
  private gameOver = false;
  private kills = 0;
  private wave = 1;
  private readonly playerStatusEffects: StatusEffect[] = [];
  private playerMoving = false;
  private fpsVisible = false;
  private nextFpsHudUpdateAt = 0;
  private levelNumber = 1;
  private currentLevel: LevelData;

  constructor(
    private readonly world: GameScene,
    private readonly ui: Ui,
    private readonly perf: PerfRecorder,
  ) {
    this.playerCollisionBody = {
      position: this.world.player.position,
      radius: PLAYER_BALANCE.radius,
      collisionLayer: 0,
    };
    this.effects = new EffectsSystem(this.world.scene, this.world.camera, this.world.materials.nova);
    this.pickups = new PickupSystem(
      this.world,
      this.events,
      this.playerCollisionBody,
      () => this.currentCollisionLayer(),
    );
    this.enemies = new EnemySystem(
      this.world,
      this.events,
      this.playerCollisionBody,
      this.resources,
      () => this.currentLevel,
      () => this.wave,
      () => this.currentCollisionLayer(),
      () => !this.playerHasStatus("invulnerable"),
    );
    this.combat = new CombatSystem(
      this.world,
      this.effects,
      this.resources,
      this.playerCollisionBody,
      () => this.currentCollisionLayer(),
      () => this.enemies.all,
      (enemy, amount, showText) => this.enemies.damageEnemy(enemy, amount, showText),
    );
    this.currentLevel = generateLevel(this.levelNumber);
    this.world.renderLevel(this.currentLevel);
    this.world.player.position.copy(tileToWorld(this.currentLevel.start));
    this.updatePlayerCollisionLayer();
    this.resetReticle();
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
    this.reset();
  }

  private readonly updatePointerWorld = (event: PointerEvent): void => {
    this.input.updatePointerFromEvent(event, this.world.camera, this.world.floor, this.world.reticle);
  };

  private updatePointerWorldFromCamera(): void {
    this.input.updatePointerWorldFromCamera(this.world.camera, this.world.floor, this.world.reticle);
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.updatePointerWorld(event);
    if (!this.canAct()) return;
    if (event.button === 0) this.combat.firePrimary(this.input.pointerWorld);
    if (event.button === 2) this.combat.fireNova();
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
      if (this.started && !this.gameOver) {
        this.setPaused(!this.paused);
      }
      return;
    }

    this.input.addKey(event.code);
    if (event.code === "Space") {
      event.preventDefault();
      if (this.canAct()) this.combat.fireNova();
    }
  };

  private canAct(): boolean {
    return this.started && !this.gameOver && !this.paused;
  }

  private applyMovement(dt: number): void {
    const input = this.getMovementInput();

    this.playerMoving = input.lengthSq() > 0;

    if (this.playerMoving) {
      input.normalize();
      this.movePlayer(input, dt);
    }

    this.checkGateTransition();
  }

  private getMovementInput(): THREE.Vector3 {
    const strafe = (this.input.hasKey("KeyD") ? 1 : 0) - (this.input.hasKey("KeyA") ? 1 : 0);
    const forward = (this.input.hasKey("KeyW") ? 1 : 0) - (this.input.hasKey("KeyS") ? 1 : 0);
    return movementInputFor({
      mode: this.ui.getMovementMode(),
      camera: this.world.camera,
      pointerWorld: this.input.pointerWorld,
      playerPosition: this.world.player.position,
      playerYaw: this.world.player.rotation.y,
      strafe,
      forward,
      target: this.movementInput,
    });
  }

  private updatePlayerAim(): void {
    const aim = this.input.pointerWorld.clone().sub(this.world.player.position).setY(0);
    if (aim.lengthSq() > 0.01) {
      this.world.player.rotation.y = this.getPlayerAimYaw(aim);
    }
  }

  private getPlayerAimYaw(aim: THREE.Vector3): number {
    return Math.atan2(aim.x, aim.z) + PLAYER_MODEL_FORWARD_OFFSET;
  }

  private updateCamera(): void {
    const offset = new THREE.Vector3(25, 26, 25);
    this.world.camera.position.copy(this.world.player.position).add(offset);
    this.world.camera.lookAt(this.world.player.position);
  }

  private movePlayer(input: THREE.Vector3, dt: number): void {
    moveOnWalkableLevel(this.currentLevel, this.world.player.position, input, PLAYER_BALANCE.speed * dt);
  }

  private checkGateTransition(): void {
    const end = exitGateToWorld(this.currentLevel.end, this.currentLevel.exitDirection);
    if (distance2D(this.world.player.position, end) < 1.15) {
      this.loadNextLevel();
    }
  }

  private regenerate(dt: number): void {
    this.resources.energy = Math.min(
      this.maxResources.energy,
      this.resources.energy + PLAYER_BALANCE.energyRegenPerSecond * dt,
    );
  }

  private setPaused(paused: boolean): void {
    this.paused = paused;
    this.ui.setPaused(paused);
  }

  private updateHud(): void {
    this.ui.updateHud({
      resources: this.resources,
      maxResources: this.maxResources,
      kills: this.kills,
      level: this.levelNumber,
      primaryReady: this.combat.primaryReady,
      novaReady: this.combat.novaReady,
    });
  }

  private processEvents(): void {
    for (const event of this.events.drain()) {
      this.processEvent(event);
    }
  }

  private processEvent(event: GameEvent): void {
    switch (event.type) {
      case "enemyDamaged":
        this.effects.spawnDamageText(event.position, Math.round(event.amount).toString());
        break;
      case "enemyKilled":
        this.kills += 1;
        this.pickups.maybeDropPickup(event.position, event.dropTable);
        break;
      case "playerDamaged":
        this.setPlayerStatus("invulnerable", PLAYER_BALANCE.invulnerabilityDuration);
        this.world.playerBody.material.color.set(
          this.resources.health <= PLAYER_BALANCE.lowHealthThreshold ? 0xff7474 : 0xffffff,
        );
        if (this.resources.health <= 0) {
          this.endGame();
        }
        break;
      case "pickupCollected":
        this.resources[event.kind] = Math.min(
          this.maxResources[event.kind],
          this.resources[event.kind] + event.amount,
        );
        break;
    }
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

  private endGame(): void {
    this.gameOver = true;
    this.setPaused(false);
    this.ui.showGameOver(this.kills);
  }

  private reset(): void {
    this.clearEntities();
    this.levelNumber = 1;
    this.currentLevel = generateLevel(this.levelNumber);
    this.world.renderLevel(this.currentLevel);
    this.world.player.position.copy(tileToWorld(this.currentLevel.start));
    this.updatePlayerCollisionLayer();
    this.resetReticle();
    this.resources.health = PLAYER_MAX.health;
    this.resources.ammo = PLAYER_MAX.ammo;
    this.resources.energy = PLAYER_MAX.energy;
    this.kills = 0;
    this.wave = 1;
    this.enemies.spawnLevelEnemies();
    this.combat.resetTimers();
    this.playerStatusEffects.length = 0;
    this.gameOver = false;
    this.paused = false;
    this.world.playerBody.material.color.set(0x9bf0df);
    this.ui.hideOverlay();
    this.ui.setHudVisible(true);
    this.ui.setPaused(false);
    this.started = true;
    this.updateHud();
  }

  private loadNextLevel(): void {
    this.clearEntities();
    this.levelNumber += 1;
    this.wave = this.levelNumber;
    this.currentLevel = generateLevel(this.levelNumber);
    this.world.renderLevel(this.currentLevel);
    this.world.player.position.copy(tileToWorld(this.currentLevel.start));
    this.updatePlayerCollisionLayer();
    this.resetReticle();
    this.enemies.spawnLevelEnemies();
    this.combat.prepareNextLevel();
    this.updateHud();
  }

  private resetReticle(): void {
    this.input.resetPointerWorld(this.world.player.position.clone().add(new THREE.Vector3(0, 0, -TILE_SIZE)));
    this.world.reticle.position.copy(this.input.pointerWorld);
  }

  private clearEntities(): void {
    this.events.clear();
    this.enemies.clear();
    this.combat.clear();
    this.pickups.clear();
    this.effects.clear();
  }

  private currentCollisionLayer(): CollisionLayer {
    return this.currentLevel.id;
  }

  private updatePlayerCollisionLayer(): void {
    this.playerCollisionBody.collisionLayer = this.currentCollisionLayer();
  }

  private playerHasStatus(kind: StatusEffect["kind"]): boolean {
    return hasStatusEffect(this.playerStatusEffects, kind);
  }

  private setPlayerStatus(kind: StatusEffect["kind"], remaining: number): void {
    setStatusEffect(this.playerStatusEffects, { kind, remaining });
  }

  private perfFrameArgs(dt: number): Record<string, number | string | boolean> {
    return {
      dtMs: Math.round(dt * 100000) / 100,
      started: this.started,
      paused: this.paused,
      gameOver: this.gameOver,
      enemies: this.enemies.count,
      projectiles: this.combat.projectileCount,
      pickups: this.pickups.count,
      damageTexts: this.effects.damageTextCount,
      novaMeshes: this.effects.novaCount,
      level: this.levelNumber,
      wave: this.wave,
      kills: this.kills,
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
      if (this.started && !this.gameOver && !this.paused) {
        this.perf.span("timers", () => {
          this.combat.updateTimers(dt);
          tickStatusEffects(this.playerStatusEffects, dt);
          this.world.playerBody.material.color.lerp(
            new THREE.Color(this.resources.health <= PLAYER_BALANCE.lowHealthThreshold ? 0xff7474 : 0x9bf0df),
            dt * 10,
          );
        });

        this.perf.span("regenerate", () => this.regenerate(dt));
        this.perf.span("movement", () => this.applyMovement(dt));
        this.perf.span("camera", () => this.updateCamera());
        this.perf.span("pointer.world", () => this.updatePointerWorldFromCamera());
        this.perf.span("player.aim", () => this.updatePlayerAim());
        this.perf.span("player.rig", () =>
          this.world.playerRig.update(
            {
              moving: this.playerMoving,
              moveSpeed: PLAYER_BALANCE.speed,
              damaged: this.playerHasStatus("invulnerable"),
              lowHealth: this.resources.health <= PLAYER_BALANCE.lowHealthThreshold,
            },
            dt,
          ),
        );
        this.perf.span("projectiles", () => this.combat.updateProjectiles(dt));
        this.perf.span("enemies", () => this.enemies.update(dt));
        this.perf.span("events.afterEnemies", () => this.processEvents());
        this.perf.span("pickups", () => this.pickups.update(dt));
        this.perf.span("events.afterPickups", () => this.processEvents());
        this.perf.span("effects/dom", () => this.effects.update(dt));
        this.perf.span("hud/dom", () => this.updateHud());
      }

      if (!this.started || this.gameOver || this.paused) {
        this.perf.span("camera", () => this.updateCamera());
      }
      this.perf.span("three.render.cpu", () => this.world.renderer.render(this.world.scene, this.world.camera));
    });
  };
}
