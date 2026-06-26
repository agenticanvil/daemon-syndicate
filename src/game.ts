import * as THREE from "three";
import { distance2D, type CollisionLayer } from "./collision";
import { RETICLE_FLOOR_OFFSET, TILE_SIZE } from "./constants";
import { CombatSystem } from "./combatSystem";
import { EffectsSystem } from "./effectsSystem";
import { EnemySystem } from "./enemySystem";
import type { EnemyKind } from "./enemyDefinitions";
import { EventQueue, type GameEvent } from "./eventQueue";
import { InputState } from "./inputState";
import { exitGateToWorld, generateLevel, tileToWorld, type LevelData, type TileCoord } from "./level";
import type { PerfRecorder } from "./perf";
import { PickupSystem } from "./pickupSystem";
import { PlayerSystem } from "./playerSystem";
import type { Rng } from "./rng";
import type { GameScene } from "./scene";
import type { PlayerResources } from "./types";
import type { Ui } from "./ui";

type GameOptions = {
  rng?: Rng;
  seed?: string;
};

export type DebugSpawnPosition = TileCoord | { x: number; y?: number; z: number };

export class Game {
  private readonly clock = new THREE.Clock();
  private readonly fpsFrameTimes: number[] = [];
  private readonly input = new InputState();
  private readonly player: PlayerSystem;
  private readonly effects: EffectsSystem;
  private readonly events = new EventQueue();
  private readonly pickups: PickupSystem;
  private readonly enemies: EnemySystem;
  private readonly combat: CombatSystem;

  private started = false;
  private paused = false;
  private gameOver = false;
  private kills = 0;
  private wave = 1;
  private fpsVisible = false;
  private nextFpsHudUpdateAt = 0;
  private levelNumber = 1;
  private currentLevel: LevelData;
  private readonly rng: Rng;
  private readonly seed?: string;

  constructor(
    private readonly world: GameScene,
    private readonly ui: Ui,
    private readonly perf: PerfRecorder,
    options: GameOptions = {},
  ) {
    this.rng = options.rng ?? Math.random;
    this.seed = options.seed;
    this.currentLevel = generateLevel(this.levelNumber, this.rng);
    this.player = new PlayerSystem(
      this.world,
      this.input,
      () => this.currentLevel,
      () => this.ui.getMovementMode(),
    );
    this.effects = new EffectsSystem(this.world.scene, this.world.camera, this.world.materials.nova);
    this.pickups = new PickupSystem(
      this.world,
      this.events,
      this.player.collisionBody,
      () => this.currentCollisionLayer(),
      this.rng,
    );
    this.enemies = new EnemySystem(
      this.world,
      this.events,
      this.player.collisionBody,
      this.player.resources,
      () => this.currentLevel,
      () => this.wave,
      () => this.currentCollisionLayer(),
      () => !this.player.hasStatus("invulnerable"),
      this.rng,
    );
    this.combat = new CombatSystem(
      this.world,
      this.effects,
      this.player.resources,
      this.player.collisionBody,
      () => this.currentCollisionLayer(),
      () => this.enemies.all,
      (enemy, amount, showText) => this.enemies.damageEnemy(enemy, amount, showText),
    );
    this.world.renderLevel(this.currentLevel);
    this.player.moveTo(tileToWorld(this.currentLevel.start), this.currentCollisionLayer());
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

  snapshot(): object {
    return {
      seed: this.seed,
      started: this.started,
      paused: this.paused,
      gameOver: this.gameOver,
      kills: this.kills,
      wave: this.wave,
      levelNumber: this.levelNumber,
      level: {
        id: this.currentLevel.id,
        width: this.currentLevel.width,
        height: this.currentLevel.height,
        exitDirection: this.currentLevel.exitDirection,
        start: { ...this.currentLevel.start },
        end: { ...this.currentLevel.end },
        walkable: [...this.currentLevel.walkable],
        blocked: [...this.currentLevel.blocked],
        environmentalObjects: this.currentLevel.environmentalObjects.map((object) => ({
          kind: object.kind,
          tile: { ...object.tile },
          rotation: object.rotation,
        })),
        spawnPoints: this.currentLevel.spawnPoints.map((spawn) => ({ ...spawn })),
      },
      player: this.player.snapshot(),
      enemies: this.enemies.snapshot(),
      combat: this.combat.snapshot(),
      pickups: this.pickups.snapshot(),
      effects: this.effects.snapshot(),
    };
  }

  spawnEnemy(kind: EnemyKind, position: DebugSpawnPosition): void {
    this.enemies.spawnEnemyAt(kind, debugPositionToWorld(position));
  }

  grantResources(resources: Partial<PlayerResources>): void {
    for (const kind of ["health", "ammo", "energy"] as const) {
      const amount = resources[kind];
      if (amount !== undefined) {
        this.player.grantResource(kind, amount);
      }
    }
    this.updateHud();
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

  private updateCamera(): void {
    const offset = new THREE.Vector3(25, 26, 25);
    this.world.camera.position.copy(this.world.player.position).add(offset);
    this.world.camera.lookAt(this.world.player.position);
  }

  private checkGateTransition(): void {
    const end = exitGateToWorld(this.currentLevel.end, this.currentLevel.exitDirection);
    if (distance2D(this.world.player.position, end) < 1.15) {
      this.loadNextLevel();
    }
  }

  private setPaused(paused: boolean): void {
    this.paused = paused;
    this.ui.setPaused(paused);
  }

  private updateHud(): void {
    this.ui.updateHud({
      resources: this.player.resources,
      maxResources: this.player.maxResources,
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
        if (this.player.damage()) {
          this.endGame();
        }
        break;
      case "pickupCollected":
        this.player.grantResource(event.kind, event.amount);
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
    this.currentLevel = generateLevel(this.levelNumber, this.rng);
    this.world.renderLevel(this.currentLevel);
    this.player.reset(tileToWorld(this.currentLevel.start), this.currentCollisionLayer());
    this.resetReticle();
    this.kills = 0;
    this.wave = 1;
    this.enemies.spawnLevelEnemies();
    this.combat.resetTimers();
    this.gameOver = false;
    this.paused = false;
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
    this.currentLevel = generateLevel(this.levelNumber, this.rng);
    this.world.renderLevel(this.currentLevel);
    this.player.moveTo(tileToWorld(this.currentLevel.start), this.currentCollisionLayer());
    this.resetReticle();
    this.enemies.spawnLevelEnemies();
    this.combat.prepareNextLevel();
    this.updateHud();
  }

  private resetReticle(): void {
    this.input.resetPointerWorld(this.world.player.position.clone().add(new THREE.Vector3(0, 0, -TILE_SIZE)));
    this.world.reticle.position.copy(this.input.pointerWorld);
    this.world.reticle.position.y = RETICLE_FLOOR_OFFSET;
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
          this.player.updateTimers(dt);
        });

        this.perf.span("regenerate", () => this.player.regenerate(dt));
        this.perf.span("movement", () => {
          this.player.applyMovement(dt);
          this.checkGateTransition();
        });
        this.perf.span("camera", () => this.updateCamera());
        this.perf.span("pointer.world", () => this.updatePointerWorldFromCamera());
        this.perf.span("player.aim", () => this.player.updateAim());
        this.perf.span("player.rig", () => this.player.updateRig(dt));
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

function debugPositionToWorld(position: DebugSpawnPosition): THREE.Vector3 {
  if ("z" in position) {
    return new THREE.Vector3(position.x, position.y ?? 0, position.z);
  }
  return tileToWorld(position);
}
