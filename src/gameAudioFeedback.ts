import * as THREE from "three";
import type { GameAudio, LoopingSound, SoundId } from "./audio";
import { TILE_SIZE } from "./constants";
import type { Enemy } from "./enemyTypes";
import type { GameStepResult } from "./gameSimulation";
import type { ResourceKind } from "./resourceTypes";

const PICKUP_SOUNDS: Record<ResourceKind, SoundId> = {
  health: "pickup-health",
  ammo: "pickup-ammo",
  energy: "pickup-energy",
};
const RESOURCE_KINDS: readonly ResourceKind[] = ["health", "ammo", "energy"];
const ENEMY_MOVEMENT_FULL_VOLUME_TILES = 1;
const ENEMY_MOVEMENT_SILENT_TILES = 10;

export class GameAudioFeedback {
  private readonly enemyMovementAudio = new Map<number, { sound: SoundId; loop: LoopingSound }>();
  private readonly liveEnemyAudioIds = new Set<number>();

  constructor(private readonly audio?: GameAudio) {}

  playStartRun(): void {
    this.audio?.play("level-transition", { volume: 0.62 });
  }

  unlock(): void {
    void this.audio?.resume().catch(() => undefined);
  }

  playPauseChanged(paused: boolean): void {
    this.audio?.play("ui-click", { volume: paused ? 0.42 : 0.58, playbackRate: paused ? 0.86 : 1.06 });
  }

  playUpgradeSelected(): void {
    this.audio?.play("upgrade-select", { volume: 0.7 });
  }

  playStep(result: GameStepResult): void {
    if (result.primaryFired) {
      this.audio?.play("primary-fire", { volume: 0.68, playbackRate: randomRate(0.045) });
    }
    if (result.projectileImpacts > 0) {
      this.audio?.play("primary-impact", {
        volume: Math.min(0.42 + result.projectileImpacts * 0.08, 0.68),
        playbackRate: randomRate(0.05),
      });
    }
    if (result.novaFired) {
      this.audio?.play("nova", { volume: 0.82 });
    }
    if (result.dashUsed) {
      this.audio?.play("dash", { volume: 0.58, playbackRate: randomRate(0.04) });
    }
    if (result.enemyHits > 0) {
      this.audio?.play("enemy-hit", {
        volume: Math.min(0.32 + result.enemyHits * 0.06, 0.66),
        playbackRate: randomRate(0.08),
      });
    }
    if (result.kills > 0) {
      this.audio?.play("enemy-death", {
        volume: Math.min(0.46 + result.kills * 0.08, 0.78),
        playbackRate: randomRate(0.06),
      });
    }
    if (result.damageTaken > 0) {
      this.audio?.play("player-hit", { volume: 0.82 });
    }
    for (const kind of RESOURCE_KINDS) {
      const amount = result.pickupsCollected[kind];
      if (amount > 0) {
        this.audio?.play(PICKUP_SOUNDS[kind], { volume: 0.56, playbackRate: randomRate(0.04) });
      }
    }
    if (result.mapDepthChanged) {
      this.audio?.play("level-transition", { volume: 0.74 });
    }
    if (result.gameOver) {
      this.audio?.play("game-over", { volume: 0.82 });
    }
  }

  updateEnemyMovement(playerPosition: THREE.Vector3, enemies: readonly Enemy[]): void {
    if (!this.audio) return;

    const liveEnemyIds = this.liveEnemyAudioIds;
    liveEnemyIds.clear();
    for (const enemy of enemies) {
      liveEnemyIds.add(enemy.id);
      const sound = enemy.movementSound;
      const volume =
        sound && enemy.animation === "walk" && enemy.deathTimer === undefined
          ? enemyMovementVolume(playerPosition.distanceTo(enemy.position) / TILE_SIZE)
          : 0;

      const existing = this.enemyMovementAudio.get(enemy.id);
      if (!sound || volume <= 0) {
        existing?.loop.stop();
        this.enemyMovementAudio.delete(enemy.id);
        continue;
      }

      if (existing && existing.sound !== sound) {
        existing.loop.stop();
        this.enemyMovementAudio.delete(enemy.id);
      }

      const loop = this.enemyMovementAudio.get(enemy.id)?.loop ?? this.audio.playLoop(sound, { volume });
      loop.setVolume(volume);
      this.enemyMovementAudio.set(enemy.id, { sound, loop });
    }

    for (const [enemyId, audio] of this.enemyMovementAudio) {
      if (!liveEnemyIds.has(enemyId)) {
        audio.loop.stop();
        this.enemyMovementAudio.delete(enemyId);
      }
    }
  }

  stopEnemyMovement(): void {
    for (const audio of this.enemyMovementAudio.values()) {
      audio.loop.stop();
    }
    this.enemyMovementAudio.clear();
  }
}

function randomRate(amount: number): number {
  return 1 + (Math.random() * 2 - 1) * amount;
}

function enemyMovementVolume(distanceTiles: number): number {
  const range = ENEMY_MOVEMENT_SILENT_TILES - ENEMY_MOVEMENT_FULL_VOLUME_TILES;
  return Math.max(0, Math.min(1, (ENEMY_MOVEMENT_SILENT_TILES - distanceTiles) / range));
}
