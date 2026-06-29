import * as THREE from "three";
import { EFFECT_BALANCE, WEAPON_BALANCE } from "./balance";
import { RETICLE_FLOOR_OFFSET, TILE_SIZE } from "./constants";
import { disposeMesh, disposeObject3D } from "./entityLifecycle";
import type { EnemyKind } from "./enemyDefinitions";
import type { LevelData } from "./level";
import type { GameScene } from "./scene";
import type { EnemyAnimation, ResourceKind } from "./types";

export type PlayerRigState = {
  moving: boolean;
  moveSpeed: number;
  damaged: boolean;
  lowHealth: boolean;
};

export type PlayerView = {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  setBodyColor: (color: number) => void;
  lerpBodyColor: (color: number, alpha: number) => void;
  updateRig: (state: PlayerRigState, dt: number) => void;
  triggerFire: () => void;
};

export type EnemyViewHandle = {
  updateRig?: (animation: EnemyAnimation, dt: number) => void;
  sync: (position: THREE.Vector3, facingYaw: number) => void;
  dispose: () => void;
};

export type ProjectileViewHandle = {
  sync: (position: THREE.Vector3) => void;
  dispose: () => void;
};

export type PickupViewHandle = {
  sync: (position: THREE.Vector3, dt: number) => void;
  dispose: () => void;
};

export type EffectsSnapshot = {
  damageTexts: Array<{ world: { x: number; y: number; z: number }; life: number; text: string }>;
  novaMeshes: Array<{ position: { x: number; y: number; z: number }; opacity: number; scale: { x: number; y: number; z: number } }>;
  projectileImpacts: Array<{ position: { x: number; y: number; z: number }; life: number }>;
};

export type GameplayView = {
  player: PlayerView;
  renderLevel: (level: LevelData) => void;
  updateFog: (playerPosition: THREE.Vector3, dt: number, instant?: boolean) => void;
  resetReticle: (position: THREE.Vector3) => void;
  createEnemyView: (kind: EnemyKind, position: THREE.Vector3, facingYaw: number) => EnemyViewHandle;
  createProjectileView: (position: THREE.Vector3, velocity: THREE.Vector3) => ProjectileViewHandle;
  createEnemyProjectileView: (position: THREE.Vector3, velocity: THREE.Vector3) => ProjectileViewHandle;
  createPickupView: (kind: ResourceKind, position: THREE.Vector3) => PickupViewHandle;
  spawnDamageText: (position: THREE.Vector3, text: string) => void;
  spawnNova: (position: THREE.Vector3) => void;
  spawnProjectileImpact: (position: THREE.Vector3, incomingVelocity: THREE.Vector3) => void;
  updateEffects: (dt: number) => void;
  clearEffects: () => void;
  snapshotEffects: () => EffectsSnapshot;
};

const PROJECTILE_FORWARD = new THREE.Vector3(0, 1, 0);
const PROJECTILE_GEOMETRY = new THREE.CylinderGeometry(
  0.045,
  0.014,
  TILE_SIZE * 0.2,
  8,
  1,
  false,
);
const IMPACT_SPARK_COUNT = 7;
const MAX_IMPACT_SPARKS = 112;
const IMPACT_SPARK_LIFE = 0.22;
const IMPACT_SPARK_GEOMETRY = new THREE.BoxGeometry(0.035, 0.035, 0.42);
const HIDDEN_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

export function createThreeGameplayView(world: GameScene): GameplayView {
  const damageTexts: Array<{ el: HTMLDivElement; world: THREE.Vector3; life: number }> = [];
  const damageTextPool: HTMLDivElement[] = [];
  const novaMeshes: THREE.Mesh[] = [];
  const projectileMeshPool: THREE.Mesh[] = [];
  const enemyProjectileMeshPool: THREE.Mesh[] = [];
  const enemyProjectileMaterial = new THREE.MeshBasicMaterial({
    color: 0x9dff38,
    transparent: true,
    opacity: 0.95,
    toneMapped: false,
  });
  const impactSparkMesh = new THREE.InstancedMesh(
    IMPACT_SPARK_GEOMETRY,
    new THREE.MeshBasicMaterial({
      color: 0x9bf0df,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
    MAX_IMPACT_SPARKS,
  );
  const impactSparkSlots = Array.from({ length: MAX_IMPACT_SPARKS }, (_, index) => index);
  const impactSparks: Array<{
    slot: number;
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    rotation: THREE.Quaternion;
    scale: THREE.Vector3;
    life: number;
  }> = [];
  const impactSparkMatrix = new THREE.Matrix4();
  const pickupMeshPools: Record<ResourceKind, THREE.Mesh[]> = {
    health: [],
    ammo: [],
    energy: [],
  };
  let elapsed = 0;

  impactSparkMesh.frustumCulled = false;
  impactSparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < MAX_IMPACT_SPARKS; i += 1) {
    impactSparkMesh.setMatrixAt(i, HIDDEN_MATRIX);
  }
  world.scene.add(impactSparkMesh);

  function acquireDamageTextElement(): HTMLDivElement {
    const el = damageTextPool.pop() ?? document.createElement("div");
    el.className = "damage-text";
    el.hidden = false;
    if (!el.isConnected) {
      document.body.appendChild(el);
    }
    return el;
  }

  function releaseDamageTextElement(el: HTMLDivElement): void {
    el.hidden = true;
    el.textContent = "";
    el.style.opacity = "0";
    el.style.transform = "translate(-9999px, -9999px)";
    damageTextPool.push(el);
  }

  function updateNovaMeshes(dt: number): void {
    for (let i = novaMeshes.length - 1; i >= 0; i -= 1) {
      const mesh = novaMeshes[i];
      mesh.scale.addScalar(dt * WEAPON_BALANCE.nova.lingerScalePerSecond);
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.opacity -= dt * WEAPON_BALANCE.nova.fadePerSecond;
      if (material.opacity <= 0) {
        world.scene.remove(mesh);
        disposeMesh(mesh);
        novaMeshes.splice(i, 1);
      }
    }
  }

  function updateDamageTexts(dt: number): void {
    for (let i = damageTexts.length - 1; i >= 0; i -= 1) {
      const damageText = damageTexts[i];
      damageText.life -= dt;
      damageText.world.y += dt * EFFECT_BALANCE.damageTextRisePerSecond;
      const projected = damageText.world.clone().project(world.camera);
      damageText.el.style.transform =
        `translate(${((projected.x + 1) * window.innerWidth) / 2}px, ${((-projected.y + 1) * window.innerHeight) / 2}px)`;
      damageText.el.style.opacity = Math.max(damageText.life / EFFECT_BALANCE.damageTextLife, 0).toString();
      if (damageText.life <= 0) {
        releaseDamageTextElement(damageText.el);
        damageTexts.splice(i, 1);
      }
    }
  }

  function updateImpactSparks(dt: number): void {
    for (let i = impactSparks.length - 1; i >= 0; i -= 1) {
      const spark = impactSparks[i];
      spark.life -= dt;
      if (spark.life <= 0) {
        impactSparkMesh.setMatrixAt(spark.slot, HIDDEN_MATRIX);
        impactSparkSlots.push(spark.slot);
        impactSparks.splice(i, 1);
        continue;
      }

      spark.position.addScaledVector(spark.velocity, dt);
      spark.velocity.multiplyScalar(Math.max(1 - dt * 4.8, 0));
      spark.velocity.y -= dt * 2.4;
      const fade = THREE.MathUtils.clamp(spark.life / IMPACT_SPARK_LIFE, 0, 1);
      impactSparkMatrix.compose(
        spark.position,
        spark.rotation,
        spark.scale.clone().multiplyScalar(0.35 + fade * 0.9),
      );
      impactSparkMesh.setMatrixAt(spark.slot, impactSparkMatrix);
    }
    if (impactSparks.length > 0) {
      impactSparkMesh.instanceMatrix.needsUpdate = true;
    }
  }

  function acquireImpactSparkSlot(): number | undefined {
    if (impactSparkSlots.length > 0) return impactSparkSlots.pop();
    const recycled = impactSparks.shift();
    return recycled?.slot;
  }

  return {
    player: {
      position: world.player.position,
      rotation: world.player.rotation,
      setBodyColor: (color) => world.playerBody.material.color.set(color),
      lerpBodyColor: (color, alpha) => world.playerBody.material.color.lerp(new THREE.Color(color), alpha),
      updateRig: (state, dt) => world.playerRig.update(state, dt),
      triggerFire: () => world.playerRig.triggerFire(),
    },
    renderLevel: world.renderLevel,
    updateFog: world.updateFog,
    resetReticle(position) {
      world.reticle.position.copy(position);
      world.reticle.position.y = RETICLE_FLOOR_OFFSET;
    },
    createEnemyView(kind, position, facingYaw) {
      const rig =
        kind === "elite"
          ? world.createEliteEnemyAsset()
          : kind === "venomSpitter"
            ? world.createVenomSpitterAsset()
            : world.createLeanHunterRig();
      rig.root.position.set(position.x, 0, position.z);
      rig.root.rotation.y = facingYaw;
      rig.root.visible = world.isTileExplored(position);
      world.scene.add(rig.root);
      return {
        updateRig: (animation, dt) => rig.update({ animation }, dt),
        sync: (nextPosition, nextFacingYaw) => {
          rig.root.position.set(nextPosition.x, 0, nextPosition.z);
          rig.root.rotation.y = nextFacingYaw;
          rig.root.visible = world.isTileExplored(nextPosition);
        },
        dispose: () => {
          world.scene.remove(rig.root);
          disposeObject3D(rig.root, true);
        },
      };
    },
    createProjectileView(position, velocity) {
      const mesh = projectileMeshPool.pop() ?? new THREE.Mesh(PROJECTILE_GEOMETRY, world.materials.projectile);
      mesh.position.copy(position);
      mesh.quaternion.setFromUnitVectors(PROJECTILE_FORWARD, velocity.clone().normalize());
      mesh.visible = world.isTileExplored(position);
      world.scene.add(mesh);
      return {
        sync: (nextPosition) => {
          mesh.position.copy(nextPosition);
          mesh.visible = world.isTileExplored(nextPosition);
        },
        dispose: () => {
          world.scene.remove(mesh);
          projectileMeshPool.push(mesh);
        },
      };
    },
    createEnemyProjectileView(position, velocity) {
      const mesh =
        enemyProjectileMeshPool.pop() ?? new THREE.Mesh(PROJECTILE_GEOMETRY, enemyProjectileMaterial);
      mesh.position.copy(position);
      mesh.quaternion.setFromUnitVectors(PROJECTILE_FORWARD, velocity.clone().normalize());
      mesh.visible = world.isTileExplored(position);
      world.scene.add(mesh);
      return {
        sync: (nextPosition) => {
          mesh.position.copy(nextPosition);
          mesh.visible = world.isTileExplored(nextPosition);
        },
        dispose: () => {
          world.scene.remove(mesh);
          enemyProjectileMeshPool.push(mesh);
        },
      };
    },
    createPickupView(kind, position) {
      const mesh = pickupMeshPools[kind].pop() ?? world.createPickupAsset(kind).root;
      mesh.position.copy(position);
      mesh.position.y = 0.45;
      mesh.rotation.set(0, 0, 0);
      mesh.visible = world.isTileExplored(position);
      world.scene.add(mesh);
      return {
        sync: (nextPosition, dt) => {
          mesh.position.copy(nextPosition);
          mesh.position.y =
            0.45 + Math.sin(elapsed * EFFECT_BALANCE.pickupBobSpeed * 1000 + mesh.id) * EFFECT_BALANCE.pickupBobHeight;
          mesh.rotation.y += dt * EFFECT_BALANCE.pickupSpinSpeed;
          mesh.visible = world.isTileExplored(nextPosition);
        },
        dispose: () => {
          world.scene.remove(mesh);
          pickupMeshPools[kind].push(mesh);
        },
      };
    },
    spawnDamageText(position, text) {
      const el = acquireDamageTextElement();
      el.textContent = text;
      el.style.opacity = "1";
      damageTexts.push({
        el,
        world: position.clone().add(new THREE.Vector3(0, EFFECT_BALANCE.damageTextHeight, 0)),
        life: EFFECT_BALANCE.damageTextLife,
      });
    },
    spawnNova(position) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.2, WEAPON_BALANCE.nova.radius, 64),
        world.materials.nova.clone(),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.copy(position);
      mesh.position.y = 0.08;
      world.scene.add(mesh);
      novaMeshes.push(mesh);
    },
    spawnProjectileImpact(position, incomingVelocity) {
      const incoming = incomingVelocity.clone();
      incoming.y = 0;
      if (incoming.lengthSq() === 0) return;
      const normal = incoming.normalize().multiplyScalar(-1);
      const tangent = new THREE.Vector3(-normal.z, 0, normal.x);
      const origin = position.clone();
      origin.y = 0.34;

      for (let i = 0; i < IMPACT_SPARK_COUNT; i += 1) {
        const slot = acquireImpactSparkSlot();
        if (slot === undefined) break;
        const spread = (i - (IMPACT_SPARK_COUNT - 1) / 2) / ((IMPACT_SPARK_COUNT - 1) / 2);
        const direction = normal
          .clone()
          .multiplyScalar(2.7 + (i % 3) * 0.45)
          .addScaledVector(tangent, spread * 2.2)
          .add(new THREE.Vector3(0, 1.25 + (i % 2) * 0.35, 0));
        const sparkPosition = origin.clone().addScaledVector(tangent, spread * 0.08);
        const rotation = new THREE.Quaternion().setFromUnitVectors(PROJECTILE_FORWARD, direction.clone().normalize());
        const scale = new THREE.Vector3(0.7, 0.7, 0.72 + Math.abs(spread) * 0.35);
        impactSparks.push({
          slot,
          position: sparkPosition,
          velocity: direction,
          rotation,
          scale,
          life: IMPACT_SPARK_LIFE * (0.72 + (i % 4) * 0.09),
        });
        impactSparkMatrix.compose(sparkPosition, rotation, scale);
        impactSparkMesh.setMatrixAt(slot, impactSparkMatrix);
      }
      impactSparkMesh.instanceMatrix.needsUpdate = true;
    },
    updateEffects(dt) {
      elapsed += dt;
      updateNovaMeshes(dt);
      updateDamageTexts(dt);
      updateImpactSparks(dt);
    },
    clearEffects() {
      for (const damageText of damageTexts.splice(0)) {
        releaseDamageTextElement(damageText.el);
      }
      for (const mesh of novaMeshes.splice(0)) {
        world.scene.remove(mesh);
        disposeMesh(mesh);
      }
      for (const spark of impactSparks.splice(0)) {
        impactSparkMesh.setMatrixAt(spark.slot, HIDDEN_MATRIX);
        impactSparkSlots.push(spark.slot);
      }
      impactSparkMesh.instanceMatrix.needsUpdate = true;
    },
    snapshotEffects() {
      return {
        damageTexts: damageTexts.map((damageText) => ({
          world: vectorSnapshot(damageText.world),
          life: damageText.life,
          text: damageText.el.textContent ?? "",
        })),
        novaMeshes: novaMeshes.map((mesh) => ({
          position: vectorSnapshot(mesh.position),
          opacity: (mesh.material as THREE.MeshBasicMaterial).opacity,
          scale: vectorSnapshot(mesh.scale),
        })),
        projectileImpacts: impactSparks.map((spark) => ({
          position: vectorSnapshot(spark.position),
          life: spark.life,
        })),
      };
    },
  };
}

export function createHeadlessGameplayView(): GameplayView {
  const playerPosition = new THREE.Vector3();
  const playerRotation = new THREE.Euler();

  const noEnemyView = (): EnemyViewHandle => ({
    sync: () => {},
    dispose: () => {},
  });
  const noProjectileView = (): ProjectileViewHandle => ({
    sync: () => {},
    dispose: () => {},
  });
  const noPickupView = (): PickupViewHandle => ({
    sync: () => {},
    dispose: () => {},
  });

  return {
    player: {
      position: playerPosition,
      rotation: playerRotation,
      setBodyColor: () => {},
      lerpBodyColor: () => {},
      updateRig: () => {},
      triggerFire: () => {},
    },
    renderLevel: () => {},
    updateFog: () => {},
    resetReticle: () => {},
    createEnemyView: noEnemyView,
    createProjectileView: noProjectileView,
    createEnemyProjectileView: noProjectileView,
    createPickupView: noPickupView,
    spawnDamageText: () => {},
    spawnNova: () => {},
    spawnProjectileImpact: () => {},
    updateEffects: () => {},
    clearEffects: () => {},
    snapshotEffects: () => ({ damageTexts: [], novaMeshes: [], projectileImpacts: [] }),
  };
}

function vectorSnapshot(vector: THREE.Vector3): { x: number; y: number; z: number } {
  return { x: vector.x, y: vector.y, z: vector.z };
}
