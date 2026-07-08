import * as THREE from "three";
import { EFFECT_BALANCE, WEAPON_BALANCE } from "./balance";
import { LEVEL_HEIGHT, LEVEL_WIDTH, RETICLE_FLOOR_OFFSET, TILE_SIZE } from "./constants";
import { disposeObject3D } from "./entityLifecycle";
import type { EnemyKind } from "./enemyDefinitions";
import type { LevelData } from "./level";
import type { GameScene, RenderLevelOptions } from "./scene";
import type { ResourceKind } from "./resourceTypes";
import type { EnemyAnimation } from "./enemyTypes";
import type { VectorSnapshot } from "./vectorTypes";
import type { PlayerRenderState } from "./playerSystem";

export type EnemyViewHandle = {
  updateRig?: (animation: EnemyAnimation, dt: number) => void;
  sync: (position: THREE.Vector3, facingYaw: number) => void;
  flashHit: () => void;
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

type EffectsSnapshot = {
  damageTexts: Array<{ world: VectorSnapshot; life: number; text: string }>;
  novaMeshes: Array<{ position: VectorSnapshot; opacity: number; scale: VectorSnapshot }>;
  projectileImpacts: Array<{ position: VectorSnapshot; life: number }>;
  enemyDeathParticles: Array<{ position: VectorSnapshot; life: number }>;
  enemyDeathDecals: Array<{ position: VectorSnapshot; variant: number }>;
};

type DamageTextState = {
  el: HTMLDivElement;
  world: THREE.Vector3;
  life: number;
};

type PulseState = {
  active: boolean;
  position: THREE.Vector3;
  life: number;
  duration: number;
  radius: number;
  seed: number;
  variant: number;
};

type SparkState = {
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  rotation: THREE.Quaternion;
  scale: THREE.Vector3;
  life: number;
};

type SplatterParticleState = SparkState & {
  duration: number;
  color: THREE.Color;
};

type DeathDecalState = {
  active: boolean;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  variant: number;
};

export type GameplayView = {
  syncPlayer: (state: PlayerRenderState, dt: number, instant?: boolean) => void;
  triggerPlayerFire: () => void;
  renderLevel: (level: LevelData, options?: RenderLevelOptions) => void;
  updateFog: (playerPosition: THREE.Vector3, dt: number, instant?: boolean) => void;
  resetReticle: (position: THREE.Vector3) => void;
  createEnemyView: (id: number, kind: EnemyKind, position: THREE.Vector3, facingYaw: number) => EnemyViewHandle;
  createProjectileView: (position: THREE.Vector3, velocity: THREE.Vector3) => ProjectileViewHandle;
  createEnemyProjectileView: (position: THREE.Vector3, velocity: THREE.Vector3) => ProjectileViewHandle;
  createPickupView: (kind: ResourceKind, position: THREE.Vector3) => PickupViewHandle;
  flashEnemy: (enemyId: number) => void;
  spawnDamageText: (position: THREE.Vector3, text: string) => void;
  spawnEnemyDeath: (position: THREE.Vector3) => void;
  spawnNova: (position: THREE.Vector3, radius: number) => void;
  spawnProjectileImpact: (position: THREE.Vector3, incomingVelocity: THREE.Vector3) => void;
  showPlayerDamage: (amount: number) => void;
  updateEffects: (dt: number) => void;
  clearEffects: () => void;
  dispose: () => void;
  snapshotEffects: () => EffectsSnapshot;
};

export type GameplayEffectAssets = {
  deathSplatterTextures: THREE.Texture[];
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
const IMPACT_SPARK_COUNT = 9;
const MAX_IMPACT_SPARKS = 144;
const IMPACT_SPARK_LIFE = 0.24;
const IMPACT_SPARK_GEOMETRY = new THREE.BoxGeometry(0.035, 0.035, 0.48);
const MAX_IMPACT_GLOWS = 16;
const IMPACT_GLOW_LIFE = 0.22;
const IMPACT_GLOW_GEOMETRY = new THREE.CircleGeometry(1, 64);
const IMPACT_GLOW_ROTATION = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const DEATH_SPLATTER_TEXTURE_URLS = [
  "/assets/effects/death-splatter-1.png",
  "/assets/effects/death-splatter-2.png",
  "/assets/effects/death-splatter-3.png",
  "/assets/effects/death-splatter-4.png",
] as const;
const DEATH_SPLATTER_PARTICLE_COUNT = 34;
const MAX_DEATH_SPLATTER_PARTICLES = 384;
const DEATH_SPLATTER_PARTICLE_LIFE = 0.62;
const DEATH_SPLATTER_PARTICLE_GEOMETRY = new THREE.IcosahedronGeometry(0.075, 1);
const MAX_DEATH_GLOWS = 12;
const DEATH_GLOW_LIFE = 0.32;
const DEATH_GLOW_GEOMETRY = new THREE.CircleGeometry(1, 72);
const MAX_DEATH_DECALS = 36;
const DEATH_DECAL_GEOMETRY = new THREE.PlaneGeometry(1, 1);
const DEATH_DECAL_FLOOR_OFFSET = 0.032;
const MAX_NOVA_PULSES = 8;
const NOVA_PULSE_HEIGHT = 1.35;
const NOVA_PULSE_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 128, 3, true);
const ENEMY_FLASH_DURATION = 0.16;
const ENEMY_FLASH_COLOR_MIX = 0.92;
const ENEMY_FLASH_EMISSIVE_BOOST = 1.55;
const PLAYER_DAMAGE_VIGNETTE_LIFE = 0.36;
const HIDDEN_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
const FLASH_COLOR = new THREE.Color(0xffffff);
const FLASH_EMISSIVE = new THREE.Color(0xd8fff8);
const DEATH_SPLATTER_DEFAULT_COLOR = new THREE.Color(0x720814);
const PREWARM_PLAYER_PROJECTILE_MESHES = 24;
const PREWARM_ENEMY_PROJECTILE_MESHES = 24;
const PREWARM_DAMAGE_TEXTS = 32;

export async function preloadGameplayEffectAssets(
  renderer: THREE.WebGLRenderer,
  anisotropy: number,
): Promise<GameplayEffectAssets> {
  const loader = new THREE.TextureLoader();
  const deathSplatterTextures = await Promise.all(
    DEATH_SPLATTER_TEXTURE_URLS.map(async (url) => {
      const texture = await loader.loadAsync(url);
      configureDeathSplatterTexture(texture, anisotropy);
      renderer.initTexture(texture);
      return texture;
    }),
  );
  return { deathSplatterTextures };
}

export function createThreeGameplayView(world: GameScene, effectAssets?: GameplayEffectAssets): GameplayView {
  const damageTexts: DamageTextState[] = [];
  const damageTextStatePool: DamageTextState[] = [];
  const damageTextPool: HTMLDivElement[] = [];
  const projectileMeshPool: THREE.Mesh[] = [];
  const enemyProjectileMeshPool: THREE.Mesh[] = [];
  const novaPulseData = new Float32Array(MAX_NOVA_PULSES * 4);
  const impactPulseData = new Float32Array(MAX_IMPACT_GLOWS * 4);
  const novaPulseGeometry = NOVA_PULSE_GEOMETRY.clone();
  const impactPulseGeometry = IMPACT_GLOW_GEOMETRY.clone();
  const novaPulseAttribute = new THREE.InstancedBufferAttribute(novaPulseData, 4);
  const impactPulseAttribute = new THREE.InstancedBufferAttribute(impactPulseData, 4);
  const novaPulseMesh = new THREE.InstancedMesh(novaPulseGeometry, world.materials.nova, MAX_NOVA_PULSES);
  const impactGlowMesh = new THREE.InstancedMesh(impactPulseGeometry, world.materials.impactPulse, MAX_IMPACT_GLOWS);
  const deathPulseData = new Float32Array(MAX_DEATH_GLOWS * 4);
  const deathPulseGeometry = DEATH_GLOW_GEOMETRY.clone();
  const deathPulseAttribute = new THREE.InstancedBufferAttribute(deathPulseData, 4);
  const deathGlowMesh = new THREE.InstancedMesh(deathPulseGeometry, createDeathBurstMaterial(), MAX_DEATH_GLOWS);
  const novaPulses: PulseState[] = createPulseStates(MAX_NOVA_PULSES);
  const impactGlows: PulseState[] = createPulseStates(MAX_IMPACT_GLOWS);
  const deathGlows: PulseState[] = createPulseStates(MAX_DEATH_GLOWS);
  let nextNovaPulseSlot = 0;
  let nextImpactGlowSlot = 0;
  let nextDeathGlowSlot = 0;
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
  const deathSplatterParticleMesh = new THREE.InstancedMesh(
    DEATH_SPLATTER_PARTICLE_GEOMETRY,
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      vertexColors: true,
      toneMapped: false,
    }),
    MAX_DEATH_SPLATTER_PARTICLES,
  );
  const impactSparkSlots = Array.from({ length: MAX_IMPACT_SPARKS }, (_, index) => index);
  const impactSparks = createSparkStates(MAX_IMPACT_SPARKS);
  const deathSplatterParticleSlots = Array.from({ length: MAX_DEATH_SPLATTER_PARTICLES }, (_, index) => index);
  const deathSplatterParticles = createSplatterParticleStates(MAX_DEATH_SPLATTER_PARTICLES);
  let nextImpactSparkSlot = 0;
  let nextDeathSplatterParticleSlot = 0;
  const deathDecalMaskData = new Uint8Array(LEVEL_WIDTH * LEVEL_HEIGHT);
  const deathDecalMaskTexture = createDeathDecalMaskTexture(deathDecalMaskData);
  const deathDecalMaterials = createDeathDecalMaterials(
    world.renderer,
    world.renderer.capabilities.getMaxAnisotropy(),
    deathDecalMaskTexture,
    effectAssets?.deathSplatterTextures,
  );
  const deathDecals = createDeathDecalStates(deathDecalMaterials);
  let nextDeathDecalSlot = 0;
  const impactSparkMatrix = new THREE.Matrix4();
  const impactSparkScale = new THREE.Vector3();
  const deathSplatterParticleMatrix = new THREE.Matrix4();
  const deathSplatterParticleScale = new THREE.Vector3();
  const impactGlowMatrix = new THREE.Matrix4();
  const impactGlowScale = new THREE.Vector3();
  const novaPulseMatrix = new THREE.Matrix4();
  const novaPulseScale = new THREE.Vector3();
  const impactIncoming = new THREE.Vector3();
  const impactNormal = new THREE.Vector3();
  const impactTangent = new THREE.Vector3();
  const impactOrigin = new THREE.Vector3();
  const impactDirection = new THREE.Vector3();
  const impactSparkPosition = new THREE.Vector3();
  const impactSparkRotation = new THREE.Quaternion();
  const impactSparkBaseScale = new THREE.Vector3();
  const deathSplatterOrigin = new THREE.Vector3();
  const deathSplatterDirection = new THREE.Vector3();
  const deathSplatterAim = new THREE.Vector3();
  const deathSplatterPosition = new THREE.Vector3();
  const deathSplatterRotation = new THREE.Quaternion();
  const deathSplatterBaseScale = new THREE.Vector3();
  const damageTextProjection = new THREE.Vector3();
  const projectileDirection = new THREE.Vector3();
  const enemyViewsById = new Map<number, EnemyViewHandle>();
  const pickupMeshPools: Record<ResourceKind, THREE.Object3D[]> = {
    health: [],
    ammo: [],
    energy: [],
  };
  const playerDamageVignette = document.createElement("div");
  let playerDamageVignetteLife = 0;
  let elapsed = 0;

  novaPulseGeometry.setAttribute("effectData", novaPulseAttribute);
  impactPulseGeometry.setAttribute("effectData", impactPulseAttribute);
  deathPulseGeometry.setAttribute("effectData", deathPulseAttribute);
  novaPulseMesh.frustumCulled = false;
  novaPulseMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  novaPulseAttribute.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < MAX_NOVA_PULSES; i += 1) {
    novaPulseMesh.setMatrixAt(i, HIDDEN_MATRIX);
  }
  world.scene.add(novaPulseMesh);
  impactSparkMesh.frustumCulled = false;
  impactSparkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < MAX_IMPACT_SPARKS; i += 1) {
    impactSparkMesh.setMatrixAt(i, HIDDEN_MATRIX);
  }
  world.scene.add(impactSparkMesh);
  deathSplatterParticleMesh.frustumCulled = false;
  deathSplatterParticleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < MAX_DEATH_SPLATTER_PARTICLES; i += 1) {
    deathSplatterParticleMesh.setMatrixAt(i, HIDDEN_MATRIX);
    deathSplatterParticleMesh.setColorAt(i, DEATH_SPLATTER_DEFAULT_COLOR);
  }
  if (deathSplatterParticleMesh.instanceColor) deathSplatterParticleMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  world.scene.add(deathSplatterParticleMesh);
  impactGlowMesh.frustumCulled = false;
  impactGlowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  impactPulseAttribute.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < MAX_IMPACT_GLOWS; i += 1) {
    impactGlowMesh.setMatrixAt(i, HIDDEN_MATRIX);
  }
  world.scene.add(impactGlowMesh);
  deathGlowMesh.frustumCulled = false;
  deathGlowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  deathPulseAttribute.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < MAX_DEATH_GLOWS; i += 1) {
    deathGlowMesh.setMatrixAt(i, HIDDEN_MATRIX);
  }
  world.scene.add(deathGlowMesh);
  for (const decal of deathDecals) {
    decal.mesh.visible = false;
    decal.mesh.renderOrder = 4;
    world.scene.add(decal.mesh);
  }
  playerDamageVignette.className = "player-damage-vignette";
  playerDamageVignette.hidden = true;
  document.body.appendChild(playerDamageVignette);
  prewarmProjectileMeshes();
  prewarmDamageTextElements();
  warmEffectShaders();

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

  function acquireDamageTextState(position: THREE.Vector3, el: HTMLDivElement): DamageTextState {
    const state = damageTextStatePool.pop() ?? {
      el,
      world: new THREE.Vector3(),
      life: 0,
    };
    state.el = el;
    state.world.copy(position);
    state.world.y += EFFECT_BALANCE.damageTextHeight;
    state.life = EFFECT_BALANCE.damageTextLife;
    return state;
  }

  function releaseDamageTextState(state: DamageTextState): void {
    releaseDamageTextElement(state.el);
    damageTextStatePool.push(state);
  }

  function prewarmDamageTextElements(): void {
    for (let i = 0; i < PREWARM_DAMAGE_TEXTS; i += 1) {
      releaseDamageTextElement(document.createElement("div"));
    }
  }

  function prewarmProjectileMeshes(): void {
    for (let i = 0; i < PREWARM_PLAYER_PROJECTILE_MESHES; i += 1) {
      projectileMeshPool.push(new THREE.Mesh(PROJECTILE_GEOMETRY, world.materials.projectile));
    }
    for (let i = 0; i < PREWARM_ENEMY_PROJECTILE_MESHES; i += 1) {
      enemyProjectileMeshPool.push(new THREE.Mesh(PROJECTILE_GEOMETRY, enemyProjectileMaterial));
    }
  }

  function warmEffectShaders(): void {
    const previousDecalVisibility = deathDecals.map((decal) => decal.mesh.visible);
    for (const decal of deathDecals) {
      decal.mesh.visible = true;
      decal.mesh.scale.setScalar(0);
    }
    world.renderer.compile(world.scene, world.camera);
    for (let i = 0; i < deathDecals.length; i += 1) {
      deathDecals[i].mesh.visible = previousDecalVisibility[i];
    }
  }

  function updateNovaPulses(dt: number): void {
    updateNovaPulseStates(dt);
  }

  function updateDamageTexts(dt: number): void {
    for (let i = damageTexts.length - 1; i >= 0; i -= 1) {
      const damageText = damageTexts[i];
      damageText.life -= dt;
      damageText.world.y += dt * EFFECT_BALANCE.damageTextRisePerSecond;
      const projected = damageTextProjection.copy(damageText.world).project(world.camera);
      damageText.el.style.transform =
        `translate(${((projected.x + 1) * window.innerWidth) / 2}px, ${((-projected.y + 1) * window.innerHeight) / 2}px)`;
      damageText.el.style.opacity = Math.max(damageText.life / EFFECT_BALANCE.damageTextLife, 0).toString();
      if (damageText.life <= 0) {
        releaseDamageTextState(damageText);
        damageTexts.splice(i, 1);
      }
    }
  }

  function updateImpactSparks(dt: number): void {
    for (let i = 0; i < impactSparks.length; i += 1) {
      const spark = impactSparks[i];
      if (!spark.active) continue;
      spark.life -= dt;
      if (spark.life <= 0) {
        spark.active = false;
        impactSparkMesh.setMatrixAt(i, HIDDEN_MATRIX);
        impactSparkSlots.push(i);
        continue;
      }

      spark.position.addScaledVector(spark.velocity, dt);
      spark.velocity.multiplyScalar(Math.max(1 - dt * 4.8, 0));
      spark.velocity.y -= dt * 2.4;
      const fade = THREE.MathUtils.clamp(spark.life / IMPACT_SPARK_LIFE, 0, 1);
      impactSparkMatrix.compose(
        spark.position,
        spark.rotation,
        impactSparkScale.copy(spark.scale).multiplyScalar(0.35 + fade * 0.9),
      );
      impactSparkMesh.setMatrixAt(i, impactSparkMatrix);
    }
    impactSparkMesh.instanceMatrix.needsUpdate = true;
  }

  function updateDeathSplatterParticles(dt: number): void {
    for (let i = 0; i < deathSplatterParticles.length; i += 1) {
      const particle = deathSplatterParticles[i];
      if (!particle.active) continue;
      particle.life -= dt;
      if (particle.life <= 0) {
        particle.active = false;
        deathSplatterParticleMesh.setMatrixAt(i, HIDDEN_MATRIX);
        deathSplatterParticleSlots.push(i);
        continue;
      }

      particle.position.addScaledVector(particle.velocity, dt);
      particle.velocity.multiplyScalar(Math.max(1 - dt * 3.4, 0));
      particle.velocity.y -= dt * 4.8;
      if (particle.position.y < 0.08) {
        particle.position.y = 0.08;
        particle.velocity.y *= -0.22;
        particle.velocity.x *= 0.52;
        particle.velocity.z *= 0.52;
      }

      const fade = THREE.MathUtils.clamp(particle.life / particle.duration, 0, 1);
      deathSplatterParticleMatrix.compose(
        particle.position,
        particle.rotation,
        deathSplatterParticleScale.copy(particle.scale).multiplyScalar(0.34 + fade * 0.96),
      );
      deathSplatterParticleMesh.setMatrixAt(i, deathSplatterParticleMatrix);
    }
    deathSplatterParticleMesh.instanceMatrix.needsUpdate = true;
  }

  function updateImpactGlows(dt: number): void {
    updatePulseStates(
      impactGlows,
      impactGlowMesh,
      impactPulseData,
      impactPulseAttribute,
      dt,
      0.42,
      0.82,
      1.6,
    );
  }

  function updateDeathGlows(dt: number): void {
    updatePulseStates(
      deathGlows,
      deathGlowMesh,
      deathPulseData,
      deathPulseAttribute,
      dt,
      0.38,
      0.96,
      1.85,
    );
  }

  function updatePlayerDamageVignette(dt: number): void {
    playerDamageVignetteLife = Math.max(0, playerDamageVignetteLife - dt);
    if (playerDamageVignetteLife <= 0) {
      playerDamageVignette.hidden = true;
      playerDamageVignette.style.opacity = "0";
      return;
    }

    const fade = playerDamageVignetteLife / PLAYER_DAMAGE_VIGNETTE_LIFE;
    playerDamageVignette.hidden = false;
    playerDamageVignette.style.opacity = (fade * fade).toFixed(3);
  }

  function acquireImpactSparkSlot(): number | undefined {
    if (impactSparkSlots.length > 0) return impactSparkSlots.pop();
    const slot = nextImpactSparkSlot;
    nextImpactSparkSlot = (nextImpactSparkSlot + 1) % MAX_IMPACT_SPARKS;
    return slot;
  }

  function acquireDeathSplatterParticleSlot(): number | undefined {
    if (deathSplatterParticleSlots.length > 0) return deathSplatterParticleSlots.pop();
    const slot = nextDeathSplatterParticleSlot;
    nextDeathSplatterParticleSlot = (nextDeathSplatterParticleSlot + 1) % MAX_DEATH_SPLATTER_PARTICLES;
    return slot;
  }

  function acquireNovaPulseSlot(): number {
    const slot = nextNovaPulseSlot;
    nextNovaPulseSlot = (nextNovaPulseSlot + 1) % MAX_NOVA_PULSES;
    return slot;
  }

  function acquireImpactGlowSlot(): number {
    const slot = nextImpactGlowSlot;
    nextImpactGlowSlot = (nextImpactGlowSlot + 1) % MAX_IMPACT_GLOWS;
    return slot;
  }

  function acquireDeathGlowSlot(): number {
    const slot = nextDeathGlowSlot;
    nextDeathGlowSlot = (nextDeathGlowSlot + 1) % MAX_DEATH_GLOWS;
    return slot;
  }

  function acquireDeathDecal(): DeathDecalState {
    const decal = deathDecals[nextDeathDecalSlot];
    nextDeathDecalSlot = (nextDeathDecalSlot + 1) % MAX_DEATH_DECALS;
    return decal;
  }

  function updateDeathDecalWalkableMask(level: LevelData): void {
    deathDecalMaskData.fill(0);
    for (const tileKey of level.walkable) {
      if (level.blocked.has(tileKey)) continue;
      const [x, y] = tileKey.split(",").map(Number);
      if (x < 0 || x >= LEVEL_WIDTH || y < 0 || y >= LEVEL_HEIGHT) continue;
      deathDecalMaskData[y * LEVEL_WIDTH + x] = 255;
    }
    deathDecalMaskTexture.needsUpdate = true;
  }

  function updatePulseStates(
    pulses: PulseState[],
    mesh: THREE.InstancedMesh,
    data: Float32Array,
    attribute: THREE.InstancedBufferAttribute,
    dt: number,
    startScale: number,
    endScale: number,
    fadePower: number,
  ): void {
    let matrixChanged = false;
    let attributeChanged = false;

    for (let i = 0; i < pulses.length; i += 1) {
      const pulse = pulses[i];
      if (!pulse.active) continue;

      pulse.life -= dt;
      if (pulse.life <= 0) {
        pulse.active = false;
        mesh.setMatrixAt(i, HIDDEN_MATRIX);
        const offset = i * 4;
        data[offset] = 1;
        data[offset + 1] = 0;
        data[offset + 2] = pulse.seed;
        data[offset + 3] = pulse.variant;
        matrixChanged = true;
        attributeChanged = true;
        continue;
      }

      const progress = 1 - THREE.MathUtils.clamp(pulse.life / pulse.duration, 0, 1);
      const fade = Math.pow(1 - progress, fadePower);
      const radius = pulse.radius * (startScale + progress * (endScale - startScale));
      impactGlowScale.set(radius, radius, radius);
      impactGlowMatrix.compose(pulse.position, IMPACT_GLOW_ROTATION, impactGlowScale);
      mesh.setMatrixAt(i, impactGlowMatrix);

      const offset = i * 4;
      data[offset] = progress;
      data[offset + 1] = fade;
      data[offset + 2] = pulse.seed;
      data[offset + 3] = pulse.variant;
      matrixChanged = true;
      attributeChanged = true;
    }

    if (matrixChanged) mesh.instanceMatrix.needsUpdate = true;
    if (attributeChanged) attribute.needsUpdate = true;
  }

  function updateNovaPulseStates(dt: number): void {
    let matrixChanged = false;
    let attributeChanged = false;

    for (let i = 0; i < novaPulses.length; i += 1) {
      const pulse = novaPulses[i];
      if (!pulse.active) continue;

      pulse.life -= dt;
      if (pulse.life <= 0) {
        pulse.active = false;
        novaPulseMesh.setMatrixAt(i, HIDDEN_MATRIX);
        const offset = i * 4;
        novaPulseData[offset] = 1;
        novaPulseData[offset + 1] = 0;
        novaPulseData[offset + 2] = pulse.seed;
        novaPulseData[offset + 3] = pulse.variant;
        matrixChanged = true;
        attributeChanged = true;
        continue;
      }

      const progress = 1 - THREE.MathUtils.clamp(pulse.life / pulse.duration, 0, 1);
      const easedProgress = 1 - Math.pow(1 - progress, WEAPON_BALANCE.nova.expansionPower);
      const fade = Math.pow(1 - progress, 1.34);
      const radius = pulse.radius * (
        WEAPON_BALANCE.nova.startScale + easedProgress * (1 - WEAPON_BALANCE.nova.startScale)
      );
      novaPulseScale.set(radius, NOVA_PULSE_HEIGHT * (0.82 + progress * 0.18), radius);
      novaPulseMatrix.compose(pulse.position, novaPulseMesh.quaternion, novaPulseScale);
      novaPulseMesh.setMatrixAt(i, novaPulseMatrix);

      const offset = i * 4;
      novaPulseData[offset] = progress;
      novaPulseData[offset + 1] = fade;
      novaPulseData[offset + 2] = pulse.seed;
      novaPulseData[offset + 3] = pulse.variant;
      matrixChanged = true;
      attributeChanged = true;
    }

    if (matrixChanged) novaPulseMesh.instanceMatrix.needsUpdate = true;
    if (attributeChanged) novaPulseAttribute.needsUpdate = true;
  }

  return {
    syncPlayer(state, dt) {
      world.player.position.copy(state.position);
      world.player.rotation.y = state.rotationY;
      world.playerRig.update(
        {
          moving: state.moving,
          moveSpeed: state.moveSpeed,
          damaged: state.damaged,
          lowHealth: state.lowHealth,
        },
        dt,
      );
    },
    triggerPlayerFire: () => world.playerRig.triggerFire(),
    renderLevel(level, options) {
      updateDeathDecalWalkableMask(level);
      world.renderLevel(level, options);
    },
    updateFog: world.updateFog,
    resetReticle(position) {
      world.reticle.position.copy(position);
      world.reticle.position.y = RETICLE_FLOOR_OFFSET;
    },
    createEnemyView(id, kind, position, facingYaw) {
      const rig = world.createEnemyAsset(kind);
      const flashMaterials = collectFlashMaterials(rig.root);
      let flashLife = 0;
      rig.root.position.set(position.x, 0, position.z);
      rig.root.rotation.y = facingYaw;
      rig.root.visible = world.isTileExplored(position);
      world.scene.add(rig.root);
      const handle: EnemyViewHandle = {
        updateRig: (animation, dt) => {
          rig.update({ animation }, dt);
          if (flashLife > 0) {
            flashLife = Math.max(0, flashLife - dt);
            applyEnemyFlash(flashMaterials, flashLife / ENEMY_FLASH_DURATION);
          }
        },
        sync: (nextPosition, nextFacingYaw) => {
          rig.root.position.set(nextPosition.x, 0, nextPosition.z);
          rig.root.rotation.y = nextFacingYaw;
          rig.root.visible = world.isTileExplored(nextPosition);
        },
        flashHit: () => {
          flashLife = ENEMY_FLASH_DURATION;
          applyEnemyFlash(flashMaterials, 1);
        },
        dispose: () => {
          restoreEnemyFlash(flashMaterials);
          world.scene.remove(rig.root);
          disposeObject3D(rig.root, true);
          enemyViewsById.delete(id);
        },
      };
      enemyViewsById.set(id, handle);
      return handle;
    },
    flashEnemy(enemyId) {
      enemyViewsById.get(enemyId)?.flashHit();
    },
    createProjectileView(position, velocity) {
      const mesh = projectileMeshPool.pop() ?? new THREE.Mesh(PROJECTILE_GEOMETRY, world.materials.projectile);
      mesh.position.copy(position);
      mesh.quaternion.setFromUnitVectors(PROJECTILE_FORWARD, projectileDirection.copy(velocity).normalize());
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
      mesh.quaternion.setFromUnitVectors(PROJECTILE_FORWARD, projectileDirection.copy(velocity).normalize());
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
      damageTexts.push(acquireDamageTextState(position, el));
    },
    spawnEnemyDeath(position) {
      deathSplatterOrigin.copy(position);
      deathSplatterOrigin.y = 0.62;

      for (let i = 0; i < DEATH_SPLATTER_PARTICLE_COUNT; i += 1) {
        const slot = acquireDeathSplatterParticleSlot();
        if (slot === undefined) break;
        const angle = elapsed * 9.11 + i * 2.399963;
        const ring = 0.42 + ((i * 37) % 100) / 100;
        const sideBias = Math.sin(elapsed * 4.7 + i * 1.91) * 0.32;
        deathSplatterDirection.set(Math.cos(angle), 0, Math.sin(angle));
        deathSplatterDirection.x += sideBias;
        deathSplatterDirection.normalize();
        deathSplatterPosition
          .copy(deathSplatterOrigin)
          .addScaledVector(deathSplatterDirection, 0.1 + ring * 0.2);
        deathSplatterPosition.y += ((i * 17) % 9) * 0.026;
        deathSplatterDirection.multiplyScalar(2.7 + ring * 3.2 + (i % 5) * 0.28);
        deathSplatterDirection.y = 1.2 + ring * 2.4 + (i % 4) * 0.18;
        deathSplatterRotation.setFromUnitVectors(PROJECTILE_FORWARD, deathSplatterAim.copy(deathSplatterDirection).normalize());
        deathSplatterBaseScale.set(
          0.54 + (i % 4) * 0.12,
          0.5 + (i % 3) * 0.1,
          0.52 + ring * 0.38,
        );

        const particle = deathSplatterParticles[slot];
        particle.active = true;
        particle.position.copy(deathSplatterPosition);
        particle.velocity.copy(deathSplatterDirection);
        particle.rotation.copy(deathSplatterRotation);
        particle.scale.copy(deathSplatterBaseScale);
        particle.life = DEATH_SPLATTER_PARTICLE_LIFE * (0.72 + (i % 7) * 0.055);
        particle.duration = particle.life;
        if (i % 4 === 0) {
          particle.color.setHex(0x2f3030);
        } else if (i % 5 === 0) {
          particle.color.setHex(0x431016);
        } else {
          particle.color.setHex(0x720814);
        }
        deathSplatterParticleMatrix.compose(deathSplatterPosition, deathSplatterRotation, deathSplatterBaseScale);
        deathSplatterParticleMesh.setMatrixAt(slot, deathSplatterParticleMatrix);
        deathSplatterParticleMesh.setColorAt(slot, particle.color);
      }
      deathSplatterParticleMesh.instanceMatrix.needsUpdate = true;
      if (deathSplatterParticleMesh.instanceColor) deathSplatterParticleMesh.instanceColor.needsUpdate = true;

      const glowSlot = acquireDeathGlowSlot();
      const glow = deathGlows[glowSlot];
      glow.active = true;
      glow.position.copy(position);
      glow.position.y = 0.07;
      glow.life = DEATH_GLOW_LIFE;
      glow.duration = DEATH_GLOW_LIFE;
      glow.radius = 1.45 + Math.sin(elapsed * 5.3 + position.x * 0.7 + position.z * 0.9) * 0.18;
      glow.seed = elapsed * 6.17 + glowSlot * 13.13;
      glow.variant = 0.58;
      impactGlowScale.set(glow.radius * 0.38, glow.radius * 0.38, glow.radius * 0.38);
      impactGlowMatrix.compose(glow.position, IMPACT_GLOW_ROTATION, impactGlowScale);
      deathGlowMesh.setMatrixAt(glowSlot, impactGlowMatrix);
      const glowOffset = glowSlot * 4;
      deathPulseData[glowOffset] = 0;
      deathPulseData[glowOffset + 1] = 1;
      deathPulseData[glowOffset + 2] = glow.seed;
      deathPulseData[glowOffset + 3] = glow.variant;
      deathGlowMesh.instanceMatrix.needsUpdate = true;
      deathPulseAttribute.needsUpdate = true;

      const variantSeed = Math.abs(Math.sin(position.x * 12.9898 + position.z * 78.233 + elapsed * 4.1));
      const variant = Math.floor(variantSeed * deathDecalMaterials.length) % deathDecalMaterials.length;
      const decal = acquireDeathDecal();
      const scale = 1.45 + variantSeed * 0.82;
      decal.active = true;
      decal.variant = variant;
      decal.mesh.material = deathDecalMaterials[variant];
      decal.mesh.position.set(position.x, DEATH_DECAL_FLOOR_OFFSET, position.z);
      decal.mesh.rotation.set(-Math.PI / 2, 0, variantSeed * Math.PI * 2);
      decal.mesh.scale.set(scale * (0.92 + variantSeed * 0.16), scale, 1);
      decal.mesh.visible = true;
    },
    spawnNova(position, novaRadius) {
      const slot = acquireNovaPulseSlot();
      const pulse = novaPulses[slot];
      pulse.active = true;
      pulse.position.copy(position);
      pulse.position.y = NOVA_PULSE_HEIGHT * 0.5;
      pulse.life = WEAPON_BALANCE.nova.duration;
      pulse.duration = WEAPON_BALANCE.nova.duration;
      pulse.radius = novaRadius;
      pulse.seed = elapsed * 3.17 + slot * 11.23;
      pulse.variant = 0.75;
      const radius = pulse.radius * WEAPON_BALANCE.nova.startScale;
      novaPulseScale.set(radius, NOVA_PULSE_HEIGHT * 0.82, radius);
      novaPulseMatrix.compose(pulse.position, novaPulseMesh.quaternion, novaPulseScale);
      novaPulseMesh.setMatrixAt(slot, novaPulseMatrix);
      const offset = slot * 4;
      novaPulseData[offset] = 0;
      novaPulseData[offset + 1] = 1;
      novaPulseData[offset + 2] = pulse.seed;
      novaPulseData[offset + 3] = pulse.variant;
      novaPulseMesh.instanceMatrix.needsUpdate = true;
      novaPulseAttribute.needsUpdate = true;
    },
    spawnProjectileImpact(position, incomingVelocity) {
      impactIncoming.copy(incomingVelocity);
      impactIncoming.y = 0;
      if (impactIncoming.lengthSq() === 0) return;
      impactNormal.copy(impactIncoming).normalize().multiplyScalar(-1);
      impactTangent.set(-impactNormal.z, 0, impactNormal.x);
      impactOrigin.copy(position);
      impactOrigin.y = 0.34;

      for (let i = 0; i < IMPACT_SPARK_COUNT; i += 1) {
        const slot = acquireImpactSparkSlot();
        if (slot === undefined) break;
        const spread = (i - (IMPACT_SPARK_COUNT - 1) / 2) / ((IMPACT_SPARK_COUNT - 1) / 2);
        const jitter = Math.sin((elapsed + i * 17.31) * 31.7) * 0.36;
        const verticalJitter = Math.cos((elapsed + i * 9.7) * 24.1) * 0.4;
        impactDirection
          .copy(impactNormal)
          .multiplyScalar(2.2 + (i % 5) * 0.32)
          .addScaledVector(impactTangent, spread * 2.6 + jitter);
        impactDirection.y = 1.0 + (i % 3) * 0.22 + verticalJitter;
        impactSparkPosition
          .copy(impactOrigin)
          .addScaledVector(impactTangent, spread * 0.11 + jitter * 0.035)
          .addScaledVector(impactNormal, 0.05 + (i % 4) * 0.015);
        impactSparkRotation.setFromUnitVectors(PROJECTILE_FORWARD, impactDirection.normalize());
        impactSparkBaseScale.set(
          0.55 + (i % 3) * 0.12,
          0.55 + (i % 4) * 0.1,
          0.62 + Math.abs(spread) * 0.46 + (i % 5) * 0.07,
        );
        impactDirection.multiplyScalar(2.2 + (i % 5) * 0.32);
        const spark = impactSparks[slot];
        spark.active = true;
        spark.position.copy(impactSparkPosition);
        spark.velocity.copy(impactDirection).multiplyScalar(0.86 + (i % 4) * 0.09);
        spark.rotation.copy(impactSparkRotation);
        spark.scale.copy(impactSparkBaseScale);
        spark.life = IMPACT_SPARK_LIFE * (0.56 + (i % 6) * 0.08);
        impactSparkMatrix.compose(impactSparkPosition, impactSparkRotation, impactSparkBaseScale);
        impactSparkMesh.setMatrixAt(slot, impactSparkMatrix);
      }
      impactSparkMesh.instanceMatrix.needsUpdate = true;

      const glowSlot = acquireImpactGlowSlot();
      const glow = impactGlows[glowSlot];
      glow.active = true;
      glow.position.copy(impactOrigin).addScaledVector(impactNormal, 0.18);
      glow.position.y = 0.09;
      glow.life = IMPACT_GLOW_LIFE;
      glow.duration = IMPACT_GLOW_LIFE;
      glow.radius = 1.35;
      glow.seed = elapsed * 5.31 + glowSlot * 7.77;
      glow.variant = 0.35;
      impactGlowScale.set(glow.radius * 0.42, glow.radius * 0.42, glow.radius * 0.42);
      impactGlowMatrix.compose(glow.position, IMPACT_GLOW_ROTATION, impactGlowScale);
      impactGlowMesh.setMatrixAt(glowSlot, impactGlowMatrix);
      const glowOffset = glowSlot * 4;
      impactPulseData[glowOffset] = 0;
      impactPulseData[glowOffset + 1] = 1;
      impactPulseData[glowOffset + 2] = glow.seed;
      impactPulseData[glowOffset + 3] = glow.variant;
      impactGlowMesh.instanceMatrix.needsUpdate = true;
      impactPulseAttribute.needsUpdate = true;
    },
    showPlayerDamage(amount) {
      const amountScale = THREE.MathUtils.clamp(amount / 32, 0.7, 1.35);
      playerDamageVignetteLife = Math.max(playerDamageVignetteLife, PLAYER_DAMAGE_VIGNETTE_LIFE * amountScale);
      playerDamageVignette.hidden = false;
      playerDamageVignette.style.opacity = Math.min(1, 0.92 * amountScale).toFixed(3);
    },
    updateEffects(dt) {
      elapsed += dt;
      updateNovaPulses(dt);
      updateDamageTexts(dt);
      updateImpactSparks(dt);
      updateImpactGlows(dt);
      updateDeathSplatterParticles(dt);
      updateDeathGlows(dt);
      updatePlayerDamageVignette(dt);
    },
    clearEffects() {
      for (const damageText of damageTexts.splice(0)) {
        releaseDamageTextState(damageText);
      }
      for (let i = 0; i < novaPulses.length; i += 1) {
        novaPulses[i].active = false;
        novaPulseMesh.setMatrixAt(i, HIDDEN_MATRIX);
        const offset = i * 4;
        novaPulseData[offset] = 1;
        novaPulseData[offset + 1] = 0;
      }
      impactSparkSlots.length = 0;
      for (let i = 0; i < impactSparks.length; i += 1) {
        impactSparks[i].active = false;
        impactSparkMesh.setMatrixAt(i, HIDDEN_MATRIX);
        impactSparkSlots.push(i);
      }
      for (let i = 0; i < impactGlows.length; i += 1) {
        impactGlows[i].active = false;
        impactGlowMesh.setMatrixAt(i, HIDDEN_MATRIX);
        const offset = i * 4;
        impactPulseData[offset] = 1;
        impactPulseData[offset + 1] = 0;
      }
      deathSplatterParticleSlots.length = 0;
      for (let i = 0; i < deathSplatterParticles.length; i += 1) {
        deathSplatterParticles[i].active = false;
        deathSplatterParticleMesh.setMatrixAt(i, HIDDEN_MATRIX);
        deathSplatterParticleSlots.push(i);
      }
      for (let i = 0; i < deathGlows.length; i += 1) {
        deathGlows[i].active = false;
        deathGlowMesh.setMatrixAt(i, HIDDEN_MATRIX);
        const offset = i * 4;
        deathPulseData[offset] = 1;
        deathPulseData[offset + 1] = 0;
      }
      for (const decal of deathDecals) {
        decal.active = false;
        decal.mesh.visible = false;
      }
      playerDamageVignetteLife = 0;
      playerDamageVignette.hidden = true;
      playerDamageVignette.style.opacity = "0";
      novaPulseMesh.instanceMatrix.needsUpdate = true;
      novaPulseAttribute.needsUpdate = true;
      impactSparkMesh.instanceMatrix.needsUpdate = true;
      deathSplatterParticleMesh.instanceMatrix.needsUpdate = true;
      impactGlowMesh.instanceMatrix.needsUpdate = true;
      impactPulseAttribute.needsUpdate = true;
      deathGlowMesh.instanceMatrix.needsUpdate = true;
      deathPulseAttribute.needsUpdate = true;
    },
    dispose() {
      this.clearEffects();
      playerDamageVignette.remove();
      for (const el of damageTextPool.splice(0)) {
        el.remove();
      }
      world.scene.remove(novaPulseMesh);
      world.scene.remove(impactGlowMesh);
      world.scene.remove(deathGlowMesh);
      world.scene.remove(impactSparkMesh);
      world.scene.remove(deathSplatterParticleMesh);
      for (const decal of deathDecals) {
        world.scene.remove(decal.mesh);
      }
      novaPulseGeometry.dispose();
      impactPulseGeometry.dispose();
      deathPulseGeometry.dispose();
      enemyProjectileMaterial.dispose();
      disposeOwnedMeshMaterial(impactSparkMesh);
      disposeOwnedMeshMaterial(deathSplatterParticleMesh);
      disposeOwnedMeshMaterial(deathGlowMesh);
      deathDecalMaterials.forEach((material) => material.dispose());
      deathDecalMaskTexture.dispose();
      for (const texture of effectAssets?.deathSplatterTextures ?? []) {
        texture.dispose();
      }
    },
    snapshotEffects() {
      return {
        damageTexts: damageTexts.map((damageText) => ({
          world: vectorSnapshot(damageText.world),
          life: damageText.life,
          text: damageText.el.textContent ?? "",
        })),
        novaMeshes: novaPulses
          .filter((pulse) => pulse.active)
          .map((pulse) => ({
            position: vectorSnapshot(pulse.position),
            opacity: THREE.MathUtils.clamp(pulse.life / pulse.duration, 0, 1),
            scale: { x: pulse.radius, y: pulse.radius, z: pulse.radius },
          })),
        projectileImpacts: impactSparks
          .filter((spark) => spark.active)
          .map((spark) => ({
            position: vectorSnapshot(spark.position),
            life: spark.life,
          })),
        enemyDeathParticles: deathSplatterParticles
          .filter((particle) => particle.active)
          .map((particle) => ({
            position: vectorSnapshot(particle.position),
            life: particle.life,
          })),
        enemyDeathDecals: deathDecals
          .filter((decal) => decal.active)
          .map((decal) => ({
            position: vectorSnapshot(decal.mesh.position),
            variant: decal.variant,
          })),
      };
    },
  };
}

function vectorSnapshot(vector: THREE.Vector3): VectorSnapshot {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function createPulseStates(count: number): PulseState[] {
  return Array.from({ length: count }, () => ({
    active: false,
    position: new THREE.Vector3(),
    life: 0,
    duration: 1,
    radius: 1,
    seed: 0,
    variant: 0,
  }));
}

function createSparkStates(count: number): SparkState[] {
  return Array.from({ length: count }, () => ({
    active: false,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    rotation: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
    life: 0,
  }));
}

function createSplatterParticleStates(count: number): SplatterParticleState[] {
  return Array.from({ length: count }, () => ({
    active: false,
    position: new THREE.Vector3(),
    velocity: new THREE.Vector3(),
    rotation: new THREE.Quaternion(),
    scale: new THREE.Vector3(),
    life: 0,
    duration: 1,
    color: new THREE.Color(),
  }));
}

function createDeathDecalMaskTexture(data: Uint8Array): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, LEVEL_WIDTH, LEVEL_HEIGHT, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createDeathDecalMaterials(
  renderer: THREE.WebGLRenderer,
  anisotropy: number,
  walkableMask: THREE.Texture,
  preloadedTextures?: THREE.Texture[],
): THREE.ShaderMaterial[] {
  const loader = new THREE.TextureLoader();
  renderer.initTexture(walkableMask);
  return DEATH_SPLATTER_TEXTURE_URLS.map((url, index) => {
    const texture = preloadedTextures?.[index] ?? loader.load(url, (loadedTexture) => {
      configureDeathSplatterTexture(loadedTexture, anisotropy);
      renderer.initTexture(loadedTexture);
    });
    configureDeathSplatterTexture(texture, anisotropy);

    return new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uWalkableMask: { value: walkableMask },
        uMaskSize: { value: new THREE.Vector2(LEVEL_WIDTH, LEVEL_HEIGHT) },
        uWorldGridSize: { value: new THREE.Vector2(LEVEL_WIDTH, LEVEL_HEIGHT) },
        uTileSize: { value: TILE_SIZE },
        uOpacity: { value: 0.9 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPosition;

        void main() {
          vUv = uv;
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D uMap;
        uniform sampler2D uWalkableMask;
        uniform vec2 uMaskSize;
        uniform vec2 uWorldGridSize;
        uniform float uTileSize;
        uniform float uOpacity;

        varying vec2 vUv;
        varying vec3 vWorldPosition;

        void main() {
          vec4 decal = texture2D(uMap, vUv);
          if (decal.a < 0.01) discard;

          vec2 tile = floor((vec2(vWorldPosition.x, vWorldPosition.z) / uTileSize) + ((uWorldGridSize - vec2(1.0)) * 0.5) + vec2(0.5));
          if (tile.x < 0.0 || tile.y < 0.0 || tile.x >= uMaskSize.x || tile.y >= uMaskSize.y) discard;

          float walkable = texture2D(uWalkableMask, (tile + vec2(0.5)) / uMaskSize).r;
          if (walkable < 0.5) discard;

          gl_FragColor = vec4(decal.rgb, decal.a * uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      toneMapped: false,
    });
  });
}

function configureDeathSplatterTexture(texture: THREE.Texture, anisotropy: number): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = anisotropy;
}

function createDeathDecalStates(materials: THREE.ShaderMaterial[]): DeathDecalState[] {
  return Array.from({ length: MAX_DEATH_DECALS }, (_, index) => {
    const material = materials[index % materials.length];
    const mesh = new THREE.Mesh(DEATH_DECAL_GEOMETRY, material);
    return {
      active: false,
      mesh,
      variant: index % materials.length,
    };
  });
}

function createDeathBurstMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uCoreColor: { value: new THREE.Color(0x8b0a18) },
      uSmokeColor: { value: new THREE.Color(0x343434) },
      uHotColor: { value: new THREE.Color(0xe21a2b) },
    },
    vertexShader: `
      attribute vec4 effectData;

      varying vec2 vUv;
      varying float vProgress;
      varying float vAlpha;
      varying float vSeed;

      void main() {
        vUv = uv;
        vProgress = effectData.x;
        vAlpha = effectData.y;
        vSeed = effectData.z;

        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uCoreColor;
      uniform vec3 uSmokeColor;
      uniform vec3 uHotColor;

      varying vec2 vUv;
      varying float vProgress;
      varying float vAlpha;
      varying float vSeed;

      float saturate(float value) {
        return clamp(value, 0.0, 1.0);
      }

      float hash(float value) {
        return fract(sin(value) * 43758.5453123);
      }

      void main() {
        vec2 centered = vUv * 2.0 - 1.0;
        float radius = length(centered);
        if (radius > 1.0) discard;

        float angle = atan(centered.y, centered.x);
        float broken = step(0.24, hash(floor((angle + 3.14159) * 9.0) + vSeed * 17.0));
        float rough = 0.84 + sin(angle * 15.0 + vSeed * 3.1) * 0.13 + sin(angle * 26.0 - vSeed) * 0.07;
        float core = smoothstep(0.46, 0.02, radius) * (1.0 - vProgress);
        float ringCenter = mix(0.22, 0.68, vProgress);
        float ring = exp(-pow((radius - ringCenter) / 0.11, 2.0)) * rough * broken;
        float streaks = pow(max(0.0, sin(angle * 12.0 + vSeed * 4.0)), 8.0);
        streaks *= exp(-pow((radius - mix(0.18, 0.86, vProgress)) / 0.18, 2.0));

        float alpha = (core * 0.8 + ring * 1.15 + streaks * 0.55) * vAlpha;
        if (alpha < 0.01) discard;

        vec3 color = uCoreColor * (core + ring * 0.75) + uSmokeColor * ring * 0.42 + uHotColor * streaks * 0.34;
        gl_FragColor = vec4(color, saturate(alpha));
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

type FlashMaterial = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;

type FlashMaterialState = {
  material: FlashMaterial;
  color: THREE.Color;
  emissive: THREE.Color;
  emissiveIntensity: number;
};

function collectFlashMaterials(root: THREE.Object3D): FlashMaterialState[] {
  const states: FlashMaterialState[] = [];
  const seen = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!isFlashMaterial(material) || seen.has(material)) continue;
      seen.add(material);
      states.push({
        material,
        color: material.color.clone(),
        emissive: material.emissive.clone(),
        emissiveIntensity: material.emissiveIntensity,
      });
    }
  });
  return states;
}

function applyEnemyFlash(states: FlashMaterialState[], amount: number): void {
  const flash = THREE.MathUtils.clamp(amount, 0, 1);
  for (const state of states) {
    state.material.color.copy(state.color).lerp(FLASH_COLOR, flash * ENEMY_FLASH_COLOR_MIX);
    state.material.emissive.copy(state.emissive).lerp(FLASH_EMISSIVE, flash);
    state.material.emissiveIntensity = state.emissiveIntensity + flash * ENEMY_FLASH_EMISSIVE_BOOST;
  }
}

function restoreEnemyFlash(states: FlashMaterialState[]): void {
  for (const state of states) {
    state.material.color.copy(state.color);
    state.material.emissive.copy(state.emissive);
    state.material.emissiveIntensity = state.emissiveIntensity;
  }
}

function isFlashMaterial(material: THREE.Material): material is FlashMaterial {
  return material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial;
}

function disposeOwnedMeshMaterial(mesh: THREE.Mesh): void {
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach((material) => material.dispose());
    return;
  }
  mesh.material.dispose();
}
