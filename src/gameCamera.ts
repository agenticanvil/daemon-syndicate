import * as THREE from "three";
import { PLAYER_SPEED, TILE_SIZE } from "./constants";
import type { GameStepResult } from "./gameSimulation";
import type { CameraSettings } from "./ui";

export type CameraViewMode = "flat" | "depth";

export const DEFAULT_CAMERA_VIEW: CameraViewMode = "depth";
export const CAMERA_VIEW_OFFSETS: Record<CameraViewMode, THREE.Vector3> = {
  flat: new THREE.Vector3(15, 16, 15),
  depth: new THREE.Vector3(12, 26, 12),
};

const CAMERA_AIM_LEAD_DISTANCE = TILE_SIZE * 2.4;
const CAMERA_VELOCITY_LEAD_SECONDS = 0.16;
const CAMERA_MAX_VELOCITY_LEAD = TILE_SIZE * 1.35;
const CAMERA_VELOCITY_LEAD_SMOOTHING = 2.8;
const CAMERA_TRAIL_DISTANCE = TILE_SIZE * 0.62;
const CAMERA_TRAIL_SPEED_FOR_MAX = PLAYER_SPEED * 0.85;
const CAMERA_TRAIL_SMOOTHING = 4.8;
const CAMERA_FOLLOW_SMOOTHING = 10.5;
const CAMERA_LOOK_SMOOTHING = 14;
const CAMERA_SHAKE_DECAY = 2.9;
const CAMERA_SHAKE_MAX = 1;
const CAMERA_SHAKE_POSITION_STRENGTH = 0.42;
const CAMERA_SHAKE_LOOK_STRENGTH = 0.18;

export class GameplayCameraController {
  private readonly cameraPosition = new THREE.Vector3();
  private readonly cameraLookAt = new THREE.Vector3();
  private readonly previousPlayerPosition = new THREE.Vector3();
  private readonly cameraTarget = new THREE.Vector3();
  private readonly cameraPositionTarget = new THREE.Vector3();
  private readonly cameraAimLead = new THREE.Vector3();
  private readonly cameraVelocityLead = new THREE.Vector3();
  private readonly cameraVelocityLeadTarget = new THREE.Vector3();
  private readonly cameraTrailOffset = new THREE.Vector3();
  private readonly cameraTrailOffsetTarget = new THREE.Vector3();
  private readonly playerVelocity = new THREE.Vector3();
  private readonly cameraShakeOffset = new THREE.Vector3();
  private readonly cameraShakeLookOffset = new THREE.Vector3();
  private readonly cameraFinalLookAt = new THREE.Vector3();

  private shake = 0;
  private shakeTime = 0;

  constructor(
    private readonly getCamera: () => THREE.Camera,
    private readonly getViewMode: () => CameraViewMode,
    private settings: CameraSettings,
  ) {}

  setSettings(settings: CameraSettings): void {
    this.settings = { ...settings };
  }

  reset(playerPosition: THREE.Vector3): void {
    this.previousPlayerPosition.copy(playerPosition);
    this.cameraTarget.copy(playerPosition);
    this.cameraLookAt.copy(playerPosition);
    this.cameraPosition.copy(playerPosition).add(this.cameraOffset());
    this.cameraTrailOffset.setScalar(0);
    this.cameraTrailOffsetTarget.setScalar(0);
    this.playerVelocity.setScalar(0);
    this.shake = 0;
    this.shakeTime = 0;
  }

  update(dt: number, playerPosition: THREE.Vector3, pointerWorld: THREE.Vector3, instant = false): void {
    this.playerVelocity.copy(playerPosition).sub(this.previousPlayerPosition).setY(0);

    if (this.settings.pointerLead) {
      this.cameraAimLead.copy(pointerWorld).sub(playerPosition).setY(0);
      if (this.cameraAimLead.length() > CAMERA_AIM_LEAD_DISTANCE) {
        this.cameraAimLead.setLength(CAMERA_AIM_LEAD_DISTANCE);
      }
      this.cameraAimLead.multiplyScalar(0.34);
    } else {
      this.cameraAimLead.setScalar(0);
    }

    if (this.settings.velocityLead && dt > 0) {
      this.cameraVelocityLeadTarget.copy(playerPosition).sub(this.previousPlayerPosition).setY(0);
      this.cameraVelocityLeadTarget.multiplyScalar(CAMERA_VELOCITY_LEAD_SECONDS / dt);
      if (this.cameraVelocityLeadTarget.length() > CAMERA_MAX_VELOCITY_LEAD) {
        this.cameraVelocityLeadTarget.setLength(CAMERA_MAX_VELOCITY_LEAD);
      }
      this.cameraVelocityLead.lerp(this.cameraVelocityLeadTarget, smoothAlpha(CAMERA_VELOCITY_LEAD_SMOOTHING, dt));
    } else {
      this.cameraVelocityLead.setScalar(0);
      this.cameraVelocityLeadTarget.setScalar(0);
    }

    if (this.settings.smoothFollow && dt > 0 && this.playerVelocity.lengthSq() > 0.0001) {
      const speed = this.playerVelocity.length() / dt;
      const trailDistance =
        CAMERA_TRAIL_DISTANCE * THREE.MathUtils.clamp(speed / CAMERA_TRAIL_SPEED_FOR_MAX, 0, 1);
      this.cameraTrailOffsetTarget.copy(this.playerVelocity).normalize().multiplyScalar(-trailDistance);
    } else {
      this.cameraTrailOffsetTarget.setScalar(0);
    }

    this.cameraTarget.copy(playerPosition).add(this.cameraAimLead).add(this.cameraVelocityLead);
    this.cameraTrailOffset.lerp(
      this.cameraTrailOffsetTarget,
      instant || !this.settings.smoothFollow ? 1 : smoothAlpha(CAMERA_TRAIL_SMOOTHING, dt),
    );
    this.cameraPositionTarget.copy(this.cameraTarget).add(this.cameraOffset()).add(this.cameraTrailOffset);
    const followAlpha = instant || !this.settings.smoothFollow ? 1 : smoothAlpha(CAMERA_FOLLOW_SMOOTHING, dt);
    const lookAlpha = instant || !this.settings.smoothFollow ? 1 : smoothAlpha(CAMERA_LOOK_SMOOTHING, dt);
    this.cameraPosition.lerp(this.cameraPositionTarget, followAlpha);
    this.cameraLookAt.lerp(this.cameraTarget, lookAlpha);
    this.previousPlayerPosition.copy(playerPosition);

    this.shake = this.settings.shake ? Math.max(0, this.shake - dt * CAMERA_SHAKE_DECAY) : 0;
    this.shakeTime += dt;
    const shake = this.shake * this.shake;
    this.cameraShakeOffset
      .set(
        shakeNoise(this.shakeTime, 17.1),
        shakeNoise(this.shakeTime, 31.7) * 0.45,
        shakeNoise(this.shakeTime, 47.3),
      )
      .multiplyScalar(CAMERA_SHAKE_POSITION_STRENGTH * shake);
    this.cameraShakeLookOffset
      .set(shakeNoise(this.shakeTime, 61.9), 0, shakeNoise(this.shakeTime, 79.4))
      .multiplyScalar(CAMERA_SHAKE_LOOK_STRENGTH * shake);

    const camera = this.getCamera();
    camera.position.copy(this.cameraPosition).add(this.cameraShakeOffset);
    camera.lookAt(this.cameraFinalLookAt.copy(this.cameraLookAt).add(this.cameraShakeLookOffset));
  }

  applyFeedback(result: GameStepResult): void {
    if (result.primaryFired) this.addShake(0.055);
    if (result.projectileImpacts > 0) this.addShake(Math.min(0.16, result.projectileImpacts * 0.035));
    if (result.enemyHits > 0) this.addShake(Math.min(0.22, result.enemyHits * 0.04));
    if (result.kills > 0) this.addShake(Math.min(0.28, result.kills * 0.075));
    if (result.damageTaken > 0) this.addShake(0.34);
    if (result.dashUsed) this.addShake(0.18);
    if (result.novaFired) this.addShake(0.3);
    if (result.mapDepthChanged) this.addShake(0.24);
  }

  private addShake(amount: number): void {
    this.shake = Math.min(CAMERA_SHAKE_MAX, this.shake + amount);
  }

  private cameraOffset(): THREE.Vector3 {
    return CAMERA_VIEW_OFFSETS[this.getViewMode()];
  }
}

function smoothAlpha(smoothing: number, dt: number): number {
  return 1 - Math.exp(-smoothing * dt);
}

function shakeNoise(time: number, seed: number): number {
  return Math.sin(time * seed) * 0.66 + Math.sin(time * (seed * 0.37 + 5.1)) * 0.34;
}
