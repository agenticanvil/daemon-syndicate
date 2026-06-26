import * as THREE from "three";
import { EFFECT_BALANCE, WEAPON_BALANCE } from "./balance";
import { disposeMesh } from "./entityLifecycle";
import type { DamageText } from "./types";

export class EffectsSystem {
  private readonly damageTexts: DamageText[] = [];
  private readonly damageTextPool: HTMLDivElement[] = [];
  private readonly novaMeshes: THREE.Mesh[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
    private readonly novaMaterial: THREE.MeshBasicMaterial,
  ) {}

  get damageTextCount(): number {
    return this.damageTexts.length;
  }

  get novaCount(): number {
    return this.novaMeshes.length;
  }

  spawnDamageText(position: THREE.Vector3, text: string): void {
    const el = this.acquireDamageTextElement();
    el.textContent = text;
    el.style.opacity = "1";
    this.damageTexts.push({
      el,
      world: position.clone().add(new THREE.Vector3(0, EFFECT_BALANCE.damageTextHeight, 0)),
      life: EFFECT_BALANCE.damageTextLife,
    });
  }

  spawnNova(position: THREE.Vector3): void {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.2, WEAPON_BALANCE.nova.radius, 64),
      this.novaMaterial.clone(),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(position);
    mesh.position.y = 0.08;
    this.scene.add(mesh);
    this.novaMeshes.push(mesh);
  }

  update(dt: number): void {
    this.updateNovaMeshes(dt);
    this.updateDamageTexts(dt);
  }

  clear(): void {
    for (const damageText of this.damageTexts.splice(0)) {
      this.releaseDamageTextElement(damageText.el);
    }
    for (const mesh of this.novaMeshes.splice(0)) {
      this.scene.remove(mesh);
      disposeMesh(mesh);
    }
  }

  snapshot(): object {
    return {
      damageTexts: this.damageTexts.map((damageText) => ({
        world: vectorSnapshot(damageText.world),
        life: damageText.life,
        text: damageText.el.textContent ?? "",
      })),
      novaMeshes: this.novaMeshes.map((mesh) => ({
        position: vectorSnapshot(mesh.position),
        opacity: (mesh.material as THREE.MeshBasicMaterial).opacity,
        scale: vectorSnapshot(mesh.scale),
      })),
    };
  }

  private updateNovaMeshes(dt: number): void {
    for (let i = this.novaMeshes.length - 1; i >= 0; i -= 1) {
      const mesh = this.novaMeshes[i];
      mesh.scale.addScalar(dt * WEAPON_BALANCE.nova.lingerScalePerSecond);
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.opacity -= dt * WEAPON_BALANCE.nova.fadePerSecond;
      if (material.opacity <= 0) {
        this.scene.remove(mesh);
        disposeMesh(mesh);
        this.novaMeshes.splice(i, 1);
      }
    }
  }

  private updateDamageTexts(dt: number): void {
    for (let i = this.damageTexts.length - 1; i >= 0; i -= 1) {
      const damageText = this.damageTexts[i];
      damageText.life -= dt;
      damageText.world.y += dt * EFFECT_BALANCE.damageTextRisePerSecond;
      const projected = damageText.world.clone().project(this.camera);
      damageText.el.style.transform =
        `translate(${((projected.x + 1) * window.innerWidth) / 2}px, ${((-projected.y + 1) * window.innerHeight) / 2}px)`;
      damageText.el.style.opacity = Math.max(damageText.life / EFFECT_BALANCE.damageTextLife, 0).toString();
      if (damageText.life <= 0) {
        this.releaseDamageTextElement(damageText.el);
        this.damageTexts.splice(i, 1);
      }
    }
  }

  private acquireDamageTextElement(): HTMLDivElement {
    const el = this.damageTextPool.pop() ?? document.createElement("div");
    el.className = "damage-text";
    el.hidden = false;
    if (!el.isConnected) {
      document.body.appendChild(el);
    }
    return el;
  }

  private releaseDamageTextElement(el: HTMLDivElement): void {
    el.hidden = true;
    el.textContent = "";
    el.style.opacity = "0";
    el.style.transform = "translate(-9999px, -9999px)";
    this.damageTextPool.push(el);
  }
}

function vectorSnapshot(vector: THREE.Vector3): { x: number; y: number; z: number } {
  return { x: vector.x, y: vector.y, z: vector.z };
}
