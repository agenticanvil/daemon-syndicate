import * as THREE from "three";
import type { CollisionLayer } from "./collision";
import { CombatSystem, type CombatSystemSnapshot } from "./combatSystem";
import { TILE_SIZE } from "./constants";
import { EnemySystem, type EnemyProjectileSystemSnapshot, type EnemySystemSnapshot } from "./enemySystem";
import type { EnemyKind } from "./enemyDefinitions";
import type { EntityViewState } from "./entityState";
import { EventQueue, type GameEvent } from "./eventQueue";
import type { FloorVariantId } from "./floorVariants";
import type { GameEffect } from "./gameEffects";
import { exitGateToWorld, generateLevel, tileToWorld, type ExitDirection, type LevelData, type TileCoord } from "./level";
import { PickupSystem, type PickupSystemSnapshot } from "./pickupSystem";
import { PlayerSystem, type PlayerRenderState, type PlayerSystemSnapshot } from "./playerSystem";
import { idlePlayerCommand } from "./playerCommand";
import { PlayerProgression, type PlayerProgressionSnapshot } from "./progression";
import type { Rng } from "./rng";
import type { PlayerResources, ResourceKind } from "./resourceTypes";
import { availableUpgradeOptions, derivePlayerStats, type PlayerDerivedStats, type UpgradeId, type UpgradeOption } from "./upgrades";

type GameSimulationOptions = {
  rng?: Rng;
  seed?: string;
  createLevel?: (mapDepth: number, rng: Rng) => LevelData;
};

type StartRunOptions = {
  mapDepth?: number;
};

export type DebugSpawnPosition = TileCoord | { x: number; y?: number; z: number };

export type GameSimulationSnapshot = {
  seed?: string;
  started: boolean;
  paused: boolean;
  gameOver: boolean;
  kills: number;
  mapDepth: number;
  progression: PlayerProgressionSnapshot;
  level: {
    mapDepth: number;
    width: number;
    height: number;
    exitDirection: ExitDirection;
    start: TileCoord;
    end: TileCoord;
    walkable: string[];
    floorVariants: Array<{ tileKey: string; variant: FloorVariantId }>;
    blocked: string[];
    environmentalObjects: Array<{ kind: string; tile: TileCoord; rotation: number }>;
    spawnPoints: TileCoord[];
  };
  player: PlayerSystemSnapshot;
  enemies: EnemySystemSnapshot;
  enemyProjectiles: EnemyProjectileSystemSnapshot;
  combat: CombatSystemSnapshot;
  pickups: PickupSystemSnapshot;
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
  pickupsCollected: Record<ResourceKind, number>;
  effects: GameEffect[];
  mapDepthChanged: boolean;
  gameOver: boolean;
};

export class GameSimulation {
  private readonly player: PlayerSystem;
  private readonly events = new EventQueue();
  private readonly pickups: PickupSystem;
  private readonly enemies: EnemySystem;
  private readonly combat: CombatSystem;
  private readonly progression = new PlayerProgression();
  private readonly stepResult = createStepResult();
  private readonly drainedEvents: GameEvent[] = [];
  private readonly entityViewState: EntityViewState = { enemies: [], projectiles: [], enemyProjectiles: [], pickups: [] };
  private derivedStatsValue = derivePlayerStats(this.progression.currentUpgrades);

  private started = false;
  private paused = false;
  private gameOver = false;
  private kills = 0;
  private mapDepth = 1;
  private currentLevel: LevelData;
  private readonly rng: Rng;
  private readonly seed?: string;
  private readonly createLevel: (mapDepth: number, rng: Rng) => LevelData;

  constructor(options: GameSimulationOptions = {}) {
    this.rng = options.rng ?? Math.random;
    this.seed = options.seed;
    this.createLevel = options.createLevel ?? generateLevel;
    this.currentLevel = this.createLevel(this.mapDepth, this.rng);
    this.player = new PlayerSystem(() => this.currentLevel, () => this.derivedStats());
    this.pickups = new PickupSystem(
      this.events,
      this.player.collisionBody,
      () => this.currentCollisionLayer(),
      this.rng,
    );
    this.enemies = new EnemySystem(
      (effect) => this.currentEffects?.push(effect),
      this.events,
      this.player.collisionBody,
      () => this.player.position,
      () => this.currentLevel,
      () => this.currentCollisionLayer(),
      () => !this.player.hasStatus("invulnerable"),
      this.rng,
    );
    this.combat = new CombatSystem(
      (effect) => this.currentEffects?.push(effect),
      this.player.resources,
      this.player.collisionBody,
      () => this.player.position,
      () => this.currentCollisionLayer(),
      () => this.currentLevel,
      () => this.derivedStats(),
      () => this.enemies.all,
      (enemy, amount, showText) => this.enemies.damageEnemy(enemy, amount, showText),
    );
    this.player.moveTo(tileToWorld(this.currentLevel.start), this.currentCollisionLayer());
  }

  private currentEffects?: GameEffect[];

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

  get currentMapDepth(): number {
    return this.mapDepth;
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
    return availableUpgradeOptions(this.progression.currentUpgrades, this.progression.level);
  }

  get progressionHudState(): Pick<PlayerProgressionSnapshot, "level" | "xp" | "xpToNextLevel" | "unspentUpgradePoints"> {
    return this.progression.hudState;
  }

  get playerPosition(): THREE.Vector3 {
    return this.player.position;
  }

  get playerRotationY(): number {
    return this.player.renderState().rotationY;
  }

  get level(): LevelData {
    return this.currentLevel;
  }

  playerRenderState(): PlayerRenderState {
    return this.player.renderState();
  }

  entityState(): EntityViewState {
    this.entityViewState.enemies = this.enemies.all;
    this.entityViewState.projectiles = this.combat.allProjectiles;
    this.entityViewState.enemyProjectiles = this.enemies.allEnemyProjectiles;
    this.entityViewState.pickups = this.pickups.all;
    return this.entityViewState;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  startNewRun(options: StartRunOptions = {}): void {
    this.reset(options);
  }

  exitToMainMenu(): void {
    this.clearEntities();
    this.started = false;
    this.paused = false;
    this.gameOver = false;
  }

  step(dt: number, command = idlePlayerCommand(this.player.position)): GameStepResult {
    const result = resetStepResult(this.stepResult);

    if (this.started && !this.gameOver && !this.paused) {
      this.currentEffects = result.effects;
      try {
        this.combat.updateTimers(dt);
        this.player.updateTimers(dt);
        this.player.regenerate(dt);
        this.player.applyMovement(command, dt);
        result.mapDepthChanged = this.checkGateTransition();
        if (!result.mapDepthChanged) {
          this.player.updateAim(command.aimWorld);
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
        }
      } finally {
        this.currentEffects = undefined;
      }
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
      mapDepth: this.mapDepth,
      progression: this.progression.snapshot(),
      level: {
        mapDepth: this.currentLevel.mapDepth,
        width: this.currentLevel.width,
        height: this.currentLevel.height,
        exitDirection: this.currentLevel.exitDirection,
        start: { ...this.currentLevel.start },
        end: { ...this.currentLevel.end },
        walkable: [...this.currentLevel.walkable],
        floorVariants: [...(this.currentLevel.floorVariants ?? new Map()).entries()].map(([tileKey, variant]) => ({
          tileKey,
          variant,
        })),
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

  grantXp(amount: number): number {
    return this.progression.grantXp(amount);
  }

  spendUpgrade(id: UpgradeId): boolean {
    const previous = this.derivedStats();
    const spent = this.progression.spendUpgrade(id);
    if (!spent) return false;

    this.refreshDerivedStats();
    this.player.applyDerivedStatsChange(previous, this.derivedStats());
    return true;
  }

  private checkGateTransition(): boolean {
    const end = exitGateToWorld(this.currentLevel.end, this.currentLevel.exitDirection);
    if (isInsideExitPortal(this.player.position, end, this.currentLevel.exitDirection)) {
      this.loadNextLevel();
      return true;
    }
    return false;
  }

  private processEvents(result: GameStepResult): void {
    this.events.drainInto(this.drainedEvents);
    for (const event of this.drainedEvents) {
      this.processEvent(event, result);
    }
    this.drainedEvents.length = 0;
  }

  private processEvent(event: GameEvent, result: GameStepResult): void {
    switch (event.type) {
      case "enemyDamaged":
        result.enemyHits += 1;
        result.effects.push({
          type: "damageText",
          position: event.position.clone(),
          text: Math.round(event.amount).toString(),
        });
        result.effects.push({
          type: "enemyHit",
          enemyId: event.enemyId,
          position: event.position.clone(),
        });
        break;
      case "enemyKilled":
        this.kills += 1;
        result.kills += 1;
        result.killedEnemies.push({ kind: event.kind, enemyLevel: event.enemyLevel, xpReward: event.xpReward });
        this.grantXp(event.xpReward);
        this.maybeRefundAmmo();
        this.pickups.maybeDropPickup(event.position, event.dropTable);
        break;
      case "playerDamaged":
        const damage = this.player.takeDamage(event.amount);
        if (damage.applied) {
          result.damageTaken += event.amount;
          result.effects.push({ type: "playerDamaged", amount: event.amount });
        }
        if (damage.gameOver) {
          this.endGame();
        }
        break;
      case "pickupCollected":
        result.pickupsCollected[event.kind] += event.amount;
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
    this.mapDepth = sanitizeStartMapDepth(options.mapDepth);
    this.currentLevel = this.createLevel(this.mapDepth, this.rng);
    this.kills = 0;
    this.progression.reset();
    this.refreshDerivedStats();
    this.player.reset(tileToWorld(this.currentLevel.start), this.currentCollisionLayer());
    this.enemies.spawnLevelEnemies();
    this.combat.resetTimers();
    this.gameOver = false;
    this.paused = false;
    this.started = true;
  }

  private loadNextLevel(): void {
    this.clearEntities();
    this.mapDepth += 1;
    this.currentLevel = this.createLevel(this.mapDepth, this.rng);
    this.player.moveTo(tileToWorld(this.currentLevel.start), this.currentCollisionLayer());
    this.enemies.spawnLevelEnemies();
    this.combat.prepareNextLevel();
  }

  private clearEntities(): void {
    this.events.clear();
    this.enemies.clear();
    this.combat.clear();
    this.pickups.clear();
  }

  private currentCollisionLayer(): CollisionLayer {
    return this.currentLevel.mapDepth;
  }

  private derivedStats(): PlayerDerivedStats {
    return this.derivedStatsValue;
  }

  private refreshDerivedStats(): void {
    this.derivedStatsValue = derivePlayerStats(this.progression.currentUpgrades);
  }

  private maybeRefundAmmo(): void {
    const chance = this.derivedStats().ammoRefundChance;
    if (chance > 0 && this.rng() < chance) {
      this.player.grantResource("ammo", 1);
    }
  }
}

function isInsideExitPortal(position: THREE.Vector3, portalCenter: THREE.Vector3, direction: ExitDirection): boolean {
  const deltaX = Math.abs(position.x - portalCenter.x);
  const deltaZ = Math.abs(position.z - portalCenter.z);
  const normalDistance = direction === "east" || direction === "west" ? deltaX : deltaZ;
  const tangentDistance = direction === "east" || direction === "west" ? deltaZ : deltaX;
  return normalDistance < 1.15 && tangentDistance < TILE_SIZE;
}

function sanitizeStartMapDepth(mapDepth: number | undefined): number {
  if (mapDepth === undefined || !Number.isFinite(mapDepth)) return 1;
  return Math.max(1, Math.floor(mapDepth));
}

function debugPositionToWorld(position: DebugSpawnPosition): THREE.Vector3 {
  if ("z" in position) {
    return new THREE.Vector3(position.x, position.y ?? 0, position.z);
  }
  return tileToWorld(position);
}

function createStepResult(): GameStepResult {
  return {
    primaryFired: false,
    novaFired: false,
    dashUsed: false,
    enemyHits: 0,
    projectileImpacts: 0,
    kills: 0,
    killedEnemies: [],
    damageTaken: 0,
    pickupsCollected: { health: 0, ammo: 0, energy: 0 },
    effects: [],
    mapDepthChanged: false,
    gameOver: false,
  };
}

function resetStepResult(result: GameStepResult): GameStepResult {
  result.primaryFired = false;
  result.novaFired = false;
  result.dashUsed = false;
  result.enemyHits = 0;
  result.projectileImpacts = 0;
  result.kills = 0;
  result.killedEnemies.length = 0;
  result.damageTaken = 0;
  result.pickupsCollected.health = 0;
  result.pickupsCollected.ammo = 0;
  result.pickupsCollected.energy = 0;
  result.effects.length = 0;
  result.mapDepthChanged = false;
  result.gameOver = false;
  return result;
}
