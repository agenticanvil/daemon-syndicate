import * as THREE from "three";
import { distance2D, type CollisionLayer } from "./collision";
import { TILE_SIZE } from "./constants";
import { CombatSystem, type CombatSystemSnapshot } from "./combatSystem";
import { EnemySystem, type EnemyProjectileSystemSnapshot, type EnemySystemSnapshot } from "./enemySystem";
import type { EnemyKind } from "./enemyDefinitions";
import { EventQueue, type GameEvent } from "./eventQueue";
import type { EffectsSnapshot, GameplayView } from "./gameView";
import { exitGateToWorld, generateLevel, tileToWorld, type ExitDirection, type LevelData, type TileCoord } from "./level";
import { PickupSystem, type PickupSystemSnapshot } from "./pickupSystem";
import { PlayerSystem, type PlayerSystemSnapshot } from "./playerSystem";
import { idlePlayerCommand } from "./playerCommand";
import { PlayerProgression, type PlayerProgressionSnapshot } from "./progression";
import type { Rng } from "./rng";
import type { PlayerResources, ResourceKind } from "./types";
import { availableUpgradeOptions, derivePlayerStats, type PlayerDerivedStats, type UpgradeId, type UpgradeOption } from "./upgrades";

type GameSimulationOptions = {
  rng?: Rng;
  seed?: string;
};

type StartRunOptions = {
  mapLevel?: number;
};

export type DebugSpawnPosition = TileCoord | { x: number; y?: number; z: number };

export type GameSimulationSnapshot = {
  seed?: string;
  started: boolean;
  paused: boolean;
  gameOver: boolean;
  kills: number;
  levelNumber: number;
  progression: PlayerProgressionSnapshot;
  level: {
    id: number;
    width: number;
    height: number;
    exitDirection: ExitDirection;
    start: TileCoord;
    end: TileCoord;
    walkable: string[];
    blocked: string[];
    environmentalObjects: Array<{ kind: string; tile: TileCoord; rotation: number }>;
    spawnPoints: TileCoord[];
  };
  player: PlayerSystemSnapshot;
  enemies: EnemySystemSnapshot;
  enemyProjectiles: EnemyProjectileSystemSnapshot;
  combat: CombatSystemSnapshot;
  pickups: PickupSystemSnapshot;
  effects: EffectsSnapshot;
};

export type GameStepResult = {
  primaryFired: boolean;
  novaFired: boolean;
  dashUsed: boolean;
  enemyHits: number;
  projectileImpacts: number;
  kills: number;
  killedEnemies: Array<{ kind: EnemyKind; enemyLevel: number; xpReward: number }>;
  damageTaken: number;
  pickupsCollected: Partial<Record<ResourceKind, number>>;
  levelChanged: boolean;
  gameOver: boolean;
};

export class GameSimulation {
  private readonly player: PlayerSystem;
  private readonly events = new EventQueue();
  private readonly pickups: PickupSystem;
  private readonly enemies: EnemySystem;
  private readonly combat: CombatSystem;
  private readonly progression = new PlayerProgression();

  private started = false;
  private paused = false;
  private gameOver = false;
  private kills = 0;
  private levelNumber = 1;
  private currentLevel: LevelData;
  private readonly rng: Rng;
  private readonly seed?: string;

  constructor(
    private readonly view: GameplayView,
    options: GameSimulationOptions = {},
  ) {
    this.rng = options.rng ?? Math.random;
    this.seed = options.seed;
    this.currentLevel = generateLevel(this.levelNumber, this.rng);
    this.player = new PlayerSystem(this.view, () => this.currentLevel, () => this.derivedStats());
    this.pickups = new PickupSystem(
      this.view,
      this.events,
      this.player.collisionBody,
      () => this.currentCollisionLayer(),
      this.rng,
    );
    this.enemies = new EnemySystem(
      this.view,
      this.events,
      this.player.collisionBody,
      () => this.currentLevel,
      () => this.currentCollisionLayer(),
      () => !this.player.hasStatus("invulnerable"),
      this.rng,
    );
    this.combat = new CombatSystem(
      this.view,
      this.player.resources,
      this.player.collisionBody,
      () => this.currentCollisionLayer(),
      () => this.currentLevel,
      () => this.derivedStats(),
      () => this.enemies.all,
      (enemy, amount, showText) => this.enemies.damageEnemy(enemy, amount, showText),
    );
    this.view.renderLevel(this.currentLevel);
    this.player.moveTo(tileToWorld(this.currentLevel.start), this.currentCollisionLayer());
    this.resetReticle();
    this.view.updateFog(this.view.player.position, 0, true);
  }

  get isStarted(): boolean {
    return this.started;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get isGameOver(): boolean {
    return this.gameOver;
  }

  get killCount(): number {
    return this.kills;
  }

  get currentLevelNumber(): number {
    return this.levelNumber;
  }

  get enemyCount(): number {
    return this.enemies.count;
  }

  get projectileCount(): number {
    return this.combat.projectileCount + this.enemies.projectileCount;
  }

  get pickupCount(): number {
    return this.pickups.count;
  }

  get damageTextCount(): number {
    return this.view.snapshotEffects().damageTexts.length;
  }

  get novaCount(): number {
    return this.view.snapshotEffects().novaMeshes.length;
  }

  get primaryReady(): boolean {
    return this.combat.primaryReady;
  }

  get novaReady(): boolean {
    return this.combat.novaReady;
  }

  get dashUnlocked(): boolean {
    return this.derivedStats().dashUnlocked;
  }

  get dashReady(): boolean {
    const stats = this.derivedStats();
    return stats.dashUnlocked && this.player.currentDashTimer <= 0 && this.player.resources.energy >= stats.dashEnergyCost;
  }

  get resources(): PlayerResources {
    return this.player.resources;
  }

  get maxResources(): PlayerResources {
    return this.player.maxResources;
  }

  get availableUpgrades(): UpgradeOption[] {
    return availableUpgradeOptions(this.progression.upgrades, this.progression.level);
  }

  get playerPosition(): THREE.Vector3 {
    return this.view.player.position;
  }

  get playerRotationY(): number {
    return this.view.player.rotation.y;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  startNewRun(options: StartRunOptions = {}): void {
    this.reset(options);
  }

  step(dt: number, command = idlePlayerCommand(this.view.player.position)): GameStepResult {
    const result: GameStepResult = {
      primaryFired: false,
      novaFired: false,
      dashUsed: false,
      enemyHits: 0,
      projectileImpacts: 0,
      kills: 0,
      killedEnemies: [],
      damageTaken: 0,
      pickupsCollected: {},
      levelChanged: false,
      gameOver: false,
    };

    if (this.started && !this.gameOver && !this.paused) {
      this.combat.updateTimers(dt);
      this.player.updateTimers(dt);
      this.player.regenerate(dt);
      this.player.applyMovement(command, dt);
      this.view.updateFog(this.view.player.position, dt);
      result.levelChanged = this.checkGateTransition();
      this.player.updateAim(command.aimWorld);
      this.player.updateRig(dt);
      if (command.firePrimary) {
        result.primaryFired = this.combat.firePrimary(command.aimWorld);
      }
      if (command.fireNova) {
        result.novaFired = this.combat.fireNova();
      }
      if (command.dash) {
        result.dashUsed = this.player.tryDash(command);
      }
      result.projectileImpacts += this.combat.updateProjectiles(dt);
      this.enemies.update(dt);
      this.processEvents(result);
      this.pickups.update(dt);
      this.processEvents(result);
      this.view.updateEffects(dt);
    }

    result.gameOver = this.gameOver;
    return result;
  }

  snapshot(): GameSimulationSnapshot {
    return {
      seed: this.seed,
      started: this.started,
      paused: this.paused,
      gameOver: this.gameOver,
      kills: this.kills,
      levelNumber: this.levelNumber,
      progression: this.progression.snapshot(),
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
      enemyProjectiles: this.enemies.projectileSnapshot(),
      combat: this.combat.snapshot(),
      pickups: this.pickups.snapshot(),
      effects: this.view.snapshotEffects(),
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
  }

  spendUpgrade(id: UpgradeId): boolean {
    const previous = this.derivedStats();
    const spent = this.progression.spendUpgrade(id);
    if (!spent) return false;

    this.player.applyDerivedStatsChange(previous, this.derivedStats());
    return true;
  }

  private checkGateTransition(): boolean {
    const end = exitGateToWorld(this.currentLevel.end, this.currentLevel.exitDirection);
    if (distance2D(this.view.player.position, end) < 1.15) {
      this.loadNextLevel();
      return true;
    }
    return false;
  }

  private processEvents(result: GameStepResult): void {
    for (const event of this.events.drain()) {
      this.processEvent(event, result);
    }
  }

  private processEvent(event: GameEvent, result: GameStepResult): void {
    switch (event.type) {
      case "enemyDamaged":
        result.enemyHits += 1;
        this.view.spawnDamageText(event.position, Math.round(event.amount).toString());
        break;
      case "enemyKilled":
        this.kills += 1;
        result.kills += 1;
        result.killedEnemies.push({ kind: event.kind, enemyLevel: event.enemyLevel, xpReward: event.xpReward });
        this.progression.grantXp(event.xpReward);
        this.maybeRefundAmmo();
        this.pickups.maybeDropPickup(event.position, event.dropTable);
        break;
      case "playerDamaged":
        const damage = this.player.takeDamage(event.amount);
        if (damage.applied) {
          result.damageTaken += event.amount;
        }
        if (damage.gameOver) {
          this.endGame();
        }
        break;
      case "pickupCollected":
        result.pickupsCollected[event.kind] = (result.pickupsCollected[event.kind] ?? 0) + event.amount;
        this.player.grantResource(event.kind, event.amount);
        break;
    }
  }

  private endGame(): void {
    this.gameOver = true;
    this.setPaused(false);
  }

  private reset(options: StartRunOptions = {}): void {
    this.clearEntities();
    this.levelNumber = sanitizeStartMapLevel(options.mapLevel);
    this.currentLevel = generateLevel(this.levelNumber, this.rng);
    this.view.renderLevel(this.currentLevel);
    this.player.reset(tileToWorld(this.currentLevel.start), this.currentCollisionLayer());
    this.resetReticle();
    this.view.updateFog(this.view.player.position, 0, true);
    this.kills = 0;
    this.progression.reset();
    this.enemies.spawnLevelEnemies();
    this.combat.resetTimers();
    this.gameOver = false;
    this.paused = false;
    this.started = true;
  }

  private loadNextLevel(): void {
    this.clearEntities();
    this.levelNumber += 1;
    this.currentLevel = generateLevel(this.levelNumber, this.rng);
    this.view.renderLevel(this.currentLevel);
    this.player.moveTo(tileToWorld(this.currentLevel.start), this.currentCollisionLayer());
    this.resetReticle();
    this.view.updateFog(this.view.player.position, 0, true);
    this.enemies.spawnLevelEnemies();
    this.combat.prepareNextLevel();
  }

  private resetReticle(): void {
    this.view.resetReticle(this.view.player.position.clone().add(new THREE.Vector3(0, 0, -TILE_SIZE)));
  }

  private clearEntities(): void {
    this.events.clear();
    this.enemies.clear();
    this.combat.clear();
    this.pickups.clear();
    this.view.clearEffects();
  }

  private currentCollisionLayer(): CollisionLayer {
    return this.currentLevel.id;
  }

  private derivedStats(): PlayerDerivedStats {
    return derivePlayerStats(this.progression.upgrades);
  }

  private maybeRefundAmmo(): void {
    const chance = this.derivedStats().ammoRefundChance;
    if (chance > 0 && this.rng() < chance) {
      this.player.grantResource("ammo", 1);
    }
  }
}

function sanitizeStartMapLevel(mapLevel: number | undefined): number {
  if (mapLevel === undefined || !Number.isFinite(mapLevel)) return 1;
  return Math.max(1, Math.floor(mapLevel));
}

function debugPositionToWorld(position: DebugSpawnPosition): THREE.Vector3 {
  if ("z" in position) {
    return new THREE.Vector3(position.x, position.y ?? 0, position.z);
  }
  return tileToWorld(position);
}
