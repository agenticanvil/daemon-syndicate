import * as THREE from "three";
import {
  createRigidSkinnedAsset,
  createStaticMergedAsset,
  type BoneDefinition,
  type RigidSkinnedPart,
  type StaticMergedPart,
  type Vector3Tuple,
} from "../riggedAsset";

const PLAYER_ARMOR_ATLAS_URL = "/assets/player-armor-atlas.png";
const PLAYER_MODEL_FLOOR_OFFSET = 0.54;

type PlayerMaterialId = "surface" | "tealGlow" | "redGlow";

export type PlayerAnimationState = {
  moving: boolean;
  moveSpeed: number;
  damaged: boolean;
  lowHealth: boolean;
};

export type PlayerRig = {
  root: THREE.Group;
  body: THREE.SkinnedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  handSocket: THREE.Group;
  setWeapon: (weapon: THREE.Object3D) => void;
  triggerFire: () => void;
  applyBasePose: () => void;
  update: (state: PlayerAnimationState, dt: number) => void;
};

type PlayerMaterials = Record<PlayerMaterialId, THREE.Material> & {
  surface: THREE.MeshStandardMaterial;
  tealGlow: THREE.MeshBasicMaterial;
  redGlow: THREE.MeshBasicMaterial;
};

const SURFACE_COLORS = {
  armor: 0x7d878a,
  softSuit: 0x4c5356,
  darkMetal: 0x5e6669,
} satisfies Record<string, THREE.ColorRepresentation>;

export function loadPlayerRig(loader: THREE.TextureLoader, anisotropy: number): PlayerRig {
  const armorAtlas = loader.load(PLAYER_ARMOR_ATLAS_URL);
  armorAtlas.colorSpace = THREE.SRGBColorSpace;
  armorAtlas.anisotropy = anisotropy;

  return createProceduralPlayerRig(armorAtlas);
}

function createProceduralPlayerRig(armorAtlas: THREE.Texture): PlayerRig {
  const materials = createPlayerMaterials(armorAtlas);
  const asset = createRigidSkinnedAsset({
    name: "player-rig",
    bones: createPlayerBones(),
    sockets: [
      {
        name: "weapon-socket",
        bone: "right-elbow",
        position: [0.01, 0.17, -0.08],
        rotation: [0, -0.02, 0],
      },
    ],
    parts: createPlayerBodyParts(),
    materials,
  });

  const root = asset.root;
  const body = asset.meshes.surface as THREE.SkinnedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const weaponSocket = asset.sockets["weapon-socket"];
  const rifle = createPulseRifle(materials);
  weaponSocket.add(rifle);

  let elapsed = 0;
  let walkBlend = 0;
  let recoil = 0;
  let equippedWeapon: THREE.Object3D = rifle;

  return {
    root,
    body,
    handSocket: weaponSocket,
    setWeapon(weapon: THREE.Object3D) {
      weaponSocket.remove(equippedWeapon);
      equippedWeapon = weapon;
      weaponSocket.add(equippedWeapon);
    },
    triggerFire() {
      recoil = 1;
    },
    applyBasePose() {
      applyPlayerBasePose(asset.bones, materials, weaponSocket);
    },
    update(state: PlayerAnimationState, dt: number) {
      elapsed += dt;
      walkBlend = THREE.MathUtils.damp(walkBlend, state.moving ? 1 : 0, 12, dt);
      recoil = THREE.MathUtils.damp(recoil, 0, 18, dt);

      const stride = elapsed * Math.max(state.moveSpeed, 4.8);
      const step = Math.sin(stride * 1.7);
      const counterStep = Math.sin(stride * 1.7 + Math.PI);
      const idle = Math.sin(elapsed * 2.2) * (1 - walkBlend);
      const damagePulse = state.damaged ? Math.sin(elapsed * 42) * 0.22 + 0.28 : 0;
      const lowHealthPulse = state.lowHealth ? (Math.sin(elapsed * 7) + 1) * 0.08 : 0;

      const bones = asset.bones;
      bones.motion.position.y = PLAYER_MODEL_FLOOR_OFFSET + 0.04 + Math.abs(step) * 0.045 * walkBlend + idle * 0.018;
      bones.motion.rotation.x = -0.05 * walkBlend;
      bones.spine.rotation.z = step * 0.055 * walkBlend;
      bones.head.rotation.z = -step * 0.04 * walkBlend;

      bones["left-hip"].rotation.x = step * 0.48 * walkBlend;
      bones["right-hip"].rotation.x = counterStep * 0.48 * walkBlend;
      bones["left-knee"].rotation.x = Math.max(0, -counterStep) * 0.38 * walkBlend;
      bones["right-knee"].rotation.x = Math.max(0, -step) * 0.38 * walkBlend;

      bones["left-shoulder"].rotation.x = -0.12 + counterStep * 0.08 * walkBlend;
      bones["right-shoulder"].rotation.x = -0.14 + step * 0.05 * walkBlend - recoil * 0.06;
      bones["left-shoulder"].rotation.y = 0.1;
      bones["right-shoulder"].rotation.y = -0.08;
      bones["left-shoulder"].rotation.z = -0.2;
      bones["right-shoulder"].rotation.z = 0.18;
      bones["left-elbow"].rotation.x = -0.12;
      bones["right-elbow"].rotation.x = -0.08 - recoil * 0.08;
      weaponSocket.position.z = -0.08 - recoil * 0.08;

      materials.tealGlow.opacity = THREE.MathUtils.clamp(0.76 + lowHealthPulse + recoil * 0.24, 0.55, 1);
      materials.redGlow.opacity = THREE.MathUtils.clamp(0.58 + damagePulse + lowHealthPulse, 0.4, 1);
    },
  };
}

function applyPlayerBasePose(
  bones: Record<string, THREE.Bone>,
  materials: PlayerMaterials,
  weaponSocket: THREE.Group,
): void {
  for (const bone of Object.values(bones)) {
    bone.rotation.set(0, 0, 0);
  }

  bones.motion.position.set(0, PLAYER_MODEL_FLOOR_OFFSET + 0.04, 0);
  bones["left-shoulder"].rotation.z = -Math.PI * 0.5;
  bones["right-shoulder"].rotation.z = Math.PI * 0.5;
  weaponSocket.position.set(0.01, 0.17, -0.08);
  weaponSocket.rotation.set(0, -0.02, 0);
  materials.tealGlow.opacity = 0.82;
  materials.redGlow.opacity = 0.62;
}

function createPlayerBones(): BoneDefinition[] {
  return [
    { name: "motion" },
    { name: "pelvis", parent: "motion", position: [0, 0.72, 0] },
    { name: "spine", parent: "motion", position: [0, 0.96, 0] },
    { name: "head", parent: "spine", position: [0, 0.92, 0] },
    { name: "left-hip", parent: "motion", position: [-0.21, 0.62, 0.02] },
    { name: "left-knee", parent: "left-hip", position: [0, -0.5, 0] },
    { name: "right-hip", parent: "motion", position: [0.21, 0.62, 0.02] },
    { name: "right-knee", parent: "right-hip", position: [0, -0.5, 0] },
    { name: "left-shoulder", parent: "motion", position: [-0.54, 1.56, -0.02] },
    { name: "left-elbow", parent: "left-shoulder", position: [-0.17, -0.44, -0.18] },
    { name: "right-shoulder", parent: "motion", position: [0.54, 1.56, -0.02] },
    { name: "right-elbow", parent: "right-shoulder", position: [0.17, -0.44, -0.18] },
  ];
}

function createPlayerBodyParts(): Array<RigidSkinnedPart<PlayerMaterialId>> {
  const parts: Array<RigidSkinnedPart<PlayerMaterialId>> = [
    surfaceBox("pelvis-armor", "pelvis", [0.56, 0.28, 0.44], [0, 0, 0], SURFACE_COLORS.armor),
    surfaceBox("torso-core", "spine", [0.72, 0.78, 0.46], [0, 0.24, 0], SURFACE_COLORS.armor, undefined, [
      1,
      1,
      0.82,
    ]),
    surfaceBox("angular-chest-plate", "spine", [0.86, 0.34, 0.13], [0, 0.44, -0.27], SURFACE_COLORS.armor),
    glowBox("chest-teal-light", "spine", [0.24, 0.035, 0.018], [0, 0.45, -0.35], "tealGlow"),
    glowBox("left-red-status", "spine", [0.06, 0.025, 0.018], [-0.25, 0.25, -0.35], "redGlow"),
    glowBox("right-red-status", "spine", [0.06, 0.025, 0.018], [0.25, 0.25, -0.35], "redGlow"),
    surfaceBox("power-pack", "spine", [0.36, 0.62, 0.22], [0, 0.28, 0.32], SURFACE_COLORS.darkMetal),
    glowBox("backpack-teal-light", "spine", [0.08, 0.34, 0.018], [0, 0.28, 0.45], "tealGlow"),
    surfaceCylinder("neck-ring", "spine", 0.18, 0.2, 0.14, 4, [0, 0.72, 0], SURFACE_COLORS.darkMetal),
    surfaceDodecahedron("helmet", "head", 0.34, [0, 0, 0], SURFACE_COLORS.armor, [0.88, 1.05, 0.78]),
    glowBox("cyan-visor", "head", [0.38, 0.1, 0.035], [0, 0.04, -0.27], "tealGlow"),
    surfaceBox("belt", "motion", [0.86, 0.13, 0.12], [0, 0.62, -0.18], SURFACE_COLORS.darkMetal),
  ];

  for (let i = -2; i <= 2; i += 1) {
    parts.push(surfaceBox(`belt-pouch-${i}`, "motion", [0.13, 0.18, 0.11], [i * 0.18, 0.6, -0.26], SURFACE_COLORS.armor));
  }

  parts.push(...createLegParts("left"));
  parts.push(...createLegParts("right"));
  parts.push(...createArmParts("left"));
  parts.push(...createArmParts("right"));

  return parts;
}

function createLegParts(side: "left" | "right"): Array<RigidSkinnedPart<PlayerMaterialId>> {
  const sign = side === "left" ? -1 : 1;
  const hip = `${side}-hip`;
  const knee = `${side}-knee`;

  return [
    surfaceBox(`${side}-thigh`, hip, [0.24, 0.46, 0.2], [0, -0.24, 0], SURFACE_COLORS.softSuit),
    surfaceBox(`${side}-thigh-plate`, hip, [0.2, 0.32, 0.1], [sign * 0.04, -0.23, -0.12], SURFACE_COLORS.armor),
    surfaceBox(`${side}-knee-pad`, knee, [0.24, 0.16, 0.16], [0, 0, -0.13], SURFACE_COLORS.armor),
    surfaceBox(`${side}-shin`, knee, [0.22, 0.52, 0.18], [0, -0.27, 0], SURFACE_COLORS.softSuit),
    surfaceBox(`${side}-shin-plate`, knee, [0.18, 0.42, 0.1], [sign * 0.03, -0.27, -0.12], SURFACE_COLORS.armor),
    surfaceBox(`${side}-boot`, knee, [0.26, 0.16, 0.42], [0, -0.56, -0.06], SURFACE_COLORS.armor),
    glowBox(`${side}-boot-teal-light`, knee, [0.1, 0.025, 0.018], [0, -0.5, -0.28], "tealGlow"),
  ];
}

function createArmParts(side: "left" | "right"): Array<RigidSkinnedPart<PlayerMaterialId>> {
  const sign = side === "left" ? -1 : 1;
  const shoulder = `${side}-shoulder`;
  const elbow = `${side}-elbow`;

  return [
    surfaceBox(`${side}-shoulder-pad`, shoulder, [0.34, 0.18, 0.4], [sign * 0.03, 0.02, -0.01], SURFACE_COLORS.armor),
    surfaceBox(`${side}-upper-arm`, shoulder, [0.16, 0.34, 0.16], [sign * 0.1, -0.24, -0.08], SURFACE_COLORS.softSuit, [
      0,
      0,
      sign * 0.12,
    ]),
    surfaceBox(`${side}-forearm`, elbow, [0.17, 0.16, 0.46], [sign * 0.04, -0.02, -0.22], SURFACE_COLORS.armor),
    glowBox(`${side}-forearm-teal-light`, elbow, [0.1, 0.024, 0.018], [sign * 0.04, 0, -0.46], "tealGlow"),
    surfaceBox(`${side}-hand`, elbow, [0.13, 0.12, 0.14], [sign * 0.07, -0.02, -0.48], SURFACE_COLORS.darkMetal),
  ];
}

function createPlayerMaterials(texture: THREE.Texture): PlayerMaterials {
  return {
    surface: createRimmedSurfaceMaterial(texture),
    tealGlow: new THREE.MeshBasicMaterial({ color: 0x54f5ff, transparent: true, opacity: 0.82 }),
    redGlow: new THREE.MeshBasicMaterial({ color: 0xff3f4f, transparent: true, opacity: 0.62 }),
  };
}

function createRimmedSurfaceMaterial(texture: THREE.Texture): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.52,
    metalness: 0.62,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.playerRimColor = { value: new THREE.Color(0x2be8e0) };
    shader.uniforms.playerRimStrength = { value: 0.24 };
    shader.fragmentShader = shader.fragmentShader.replace(
      "void main() {",
      `
      uniform vec3 playerRimColor;
      uniform float playerRimStrength;

      void main() {
      `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `
      #include <emissivemap_fragment>
      float playerRim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.2);
      totalEmissiveRadiance += playerRimColor * playerRimStrength * playerRim;
      `,
    );
  };
  material.customProgramCacheKey = () => "player-rim-surface";

  return material;
}

function createPulseRifle(materials: PlayerMaterials): THREE.Group {
  return createStaticMergedAsset({
    name: "pulse-rifle",
    materials,
    parts: [
      staticSurfaceBox("rifle-receiver", [0.2, 0.16, 0.62], [0.02, -0.01, -0.52], SURFACE_COLORS.darkMetal),
      staticSurfaceBox("rifle-barrel", [0.08, 0.08, 0.72], [0.02, -0.01, -1.16], SURFACE_COLORS.darkMetal),
      staticSurfaceBox("rifle-stock", [0.18, 0.13, 0.26], [0.02, -0.01, -0.1], SURFACE_COLORS.armor),
      staticSurfaceBox("rifle-grip", [0.08, 0.24, 0.1], [0.04, -0.19, -0.4], SURFACE_COLORS.armor, [-0.3, 0, 0]),
      staticGlowBox("rifle-muzzle-glow", [0.1, 0.1, 0.035], [0.02, -0.01, -1.54], "tealGlow"),
      staticGlowBox("rifle-teal-light", [0.1, 0.025, 0.018], [0.02, 0.05, -0.85], "tealGlow"),
    ],
  });
}

function surfaceBox(
  name: string,
  bone: string,
  size: Vector3Tuple,
  position: Vector3Tuple,
  color: THREE.ColorRepresentation,
  rotation?: Vector3Tuple,
  scale?: Vector3Tuple,
): RigidSkinnedPart<PlayerMaterialId> {
  return {
    name,
    bone,
    material: "surface",
    geometry: new THREE.BoxGeometry(...size),
    position,
    rotation,
    scale,
    color,
  };
}

function surfaceCylinder(
  name: string,
  bone: string,
  radiusTop: number,
  radiusBottom: number,
  height: number,
  radialSegments: number,
  position: Vector3Tuple,
  color: THREE.ColorRepresentation,
): RigidSkinnedPart<PlayerMaterialId> {
  return {
    name,
    bone,
    material: "surface",
    geometry: new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments),
    position,
    color,
  };
}

function surfaceDodecahedron(
  name: string,
  bone: string,
  radius: number,
  position: Vector3Tuple,
  color: THREE.ColorRepresentation,
  scale?: Vector3Tuple,
): RigidSkinnedPart<PlayerMaterialId> {
  return {
    name,
    bone,
    material: "surface",
    geometry: new THREE.DodecahedronGeometry(radius, 0),
    position,
    scale,
    color,
  };
}

function glowBox(
  name: string,
  bone: string,
  size: Vector3Tuple,
  position: Vector3Tuple,
  material: "tealGlow" | "redGlow",
): RigidSkinnedPart<PlayerMaterialId> {
  return { name, bone, material, geometry: new THREE.BoxGeometry(...size), position };
}

function staticSurfaceBox(
  name: string,
  size: Vector3Tuple,
  position: Vector3Tuple,
  color: THREE.ColorRepresentation,
  rotation?: Vector3Tuple,
): StaticMergedPart<PlayerMaterialId> {
  return {
    name,
    material: "surface",
    geometry: new THREE.BoxGeometry(...size),
    position,
    rotation,
    color,
  };
}

function staticGlowBox(
  name: string,
  size: Vector3Tuple,
  position: Vector3Tuple,
  material: "tealGlow" | "redGlow",
): StaticMergedPart<PlayerMaterialId> {
  return { name, material, geometry: new THREE.BoxGeometry(...size), position };
}
