import * as THREE from "three";
import { RETICLE_FLOOR_OFFSET } from "./constants";

export class InputState {
  readonly pointerWorld = new THREE.Vector3(0, 0, -1);

  private readonly keys = new Set<string>();
  private readonly pointer = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private hasPointerPosition = false;
  private primaryFireRequested = false;
  private novaFireRequested = false;
  private dashRequested = false;

  addKey(code: string): void {
    this.keys.add(code);
  }

  deleteKey(code: string): void {
    this.keys.delete(code);
  }

  clear(): void {
    this.keys.clear();
    this.primaryFireRequested = false;
    this.novaFireRequested = false;
    this.dashRequested = false;
  }

  hasKey(code: string): boolean {
    return this.keys.has(code);
  }

  requestPrimaryFire(): void {
    this.primaryFireRequested = true;
  }

  requestNovaFire(): void {
    this.novaFireRequested = true;
  }

  requestDash(): void {
    this.dashRequested = true;
  }

  consumePrimaryFire(): boolean {
    const requested = this.primaryFireRequested;
    this.primaryFireRequested = false;
    return requested;
  }

  consumeNovaFire(): boolean {
    const requested = this.novaFireRequested;
    this.novaFireRequested = false;
    return requested;
  }

  consumeDash(): boolean {
    const requested = this.dashRequested;
    this.dashRequested = false;
    return requested;
  }

  updatePointerFromEvent(
    event: PointerEvent,
    camera: THREE.Camera,
    floor: THREE.Object3D,
    reticle: THREE.Object3D,
  ): void {
    this.hasPointerPosition = true;
    this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
    this.updatePointerWorldFromCamera(camera, floor, reticle);
  }

  updatePointerWorldFromCamera(camera: THREE.Camera, floor: THREE.Object3D, reticle: THREE.Object3D): void {
    if (!this.hasPointerPosition) return;

    this.raycaster.setFromCamera(this.pointer, camera);
    const hit = this.raycaster.intersectObject(floor, false)[0];
    if (hit) {
      this.pointerWorld.copy(hit.point);
      this.pointerWorld.y = 0;
      reticle.position.copy(this.pointerWorld);
      reticle.position.y = RETICLE_FLOOR_OFFSET;
    }
  }

  resetPointerWorld(position: THREE.Vector3): void {
    this.pointerWorld.copy(position);
  }
}
