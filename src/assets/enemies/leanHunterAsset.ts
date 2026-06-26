import * as THREE from "three";
import type { EnemyAssetSettings } from "../../assetSettings";
import {
  createRigidSkinnedAsset,
  type BoneDefinition,
  type RigidSkinnedPart,
  type Vector3Tuple,
} from "../riggedAsset";
import leanHunterSettings from "./leanHunter.settings.json";

const LEAN_HUNTER_ATLAS_URL = "/assets/lean-hunter-atlas.png";
const FLOOR_OFFSET = 0.08;

export type LeanHunterAnimationId = "idle" | "walk" | "melee" | "death";

export const LEAN_HUNTER_SETTINGS = leanHunterSettings as EnemyAssetSettings;

export type LeanHunterAnimationState = {
  animation: LeanHunterAnimationId;
};

export type LeanHunterRigOptions = {
  atlasUrl?: string;
  name?: string;
  rimColor?: THREE.ColorRepresentation;
  rimStrength?: number;
};

export type LeanHunterRig = {
  root: THREE.Group;
  body: THREE.SkinnedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  skeleton: THREE.Skeleton;
  update: (state: LeanHunterAnimationState, dt: number) => void;
};

type LeanHunterMaterialId = "surface";
type LegId = "front-left" | "front-right" | "rear-left" | "rear-right";

type AtlasRect = [number, number, number, number];

type BoneSnapshot = {
  position: THREE.Vector3;
  rotation: THREE.Euler;
};

const LEG_DEFINITIONS = [
  { id: "front-left", x: -1, z: -1, phase: 0 },
  { id: "front-right", x: 1, z: -1, phase: Math.PI },
  { id: "rear-left", x: -1, z: 1, phase: Math.PI },
  { id: "rear-right", x: 1, z: 1, phase: 0 },
] as const satisfies Array<{ id: LegId; x: -1 | 1; z: -1 | 1; phase: number }>;

const ATLAS = {
  darkPlate: [0.18, 0.13, 0.35, 0.32],
  scratchedPlate: [0.43, 0.42, 0.6, 0.6],
  redOptic: [0.58, 0.06, 0.67, 0.2],
  cyanStrip: [0.79, 0.32, 0.87, 0.54],
  blade: [0.73, 0.78, 0.95, 0.95],
  cable: [0.02, 0.55, 0.2, 0.72],
  greenCore: [0.56, 0.58, 0.63, 0.73],
} satisfies Record<string, AtlasRect>;

export function loadLeanHunterRig(
  loader: THREE.TextureLoader,
  anisotropy: number,
  options: LeanHunterRigOptions = {},
): LeanHunterRig {
  const atlas = loader.load(options.atlasUrl ?? LEAN_HUNTER_ATLAS_URL);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = anisotropy;
  atlas.wrapS = THREE.ClampToEdgeWrapping;
  atlas.wrapT = THREE.ClampToEdgeWrapping;

  return createProceduralLeanHunterRig(atlas, options);
}

function createProceduralLeanHunterRig(atlas: THREE.Texture, options: LeanHunterRigOptions): LeanHunterRig {
  const material = createSurfaceMaterial(atlas, options.rimColor, options.rimStrength);
  const bones = createLeanHunterBones();
  const asset = createRigidSkinnedAsset({
    name: options.name ?? "lean-hunter-rig",
    bones,
    parts: createLeanHunterParts(),
    materials: { surface: material },
  });

  const basePose = captureBasePose(asset.bones);
  let elapsed = 0;
  let activeAnimation: LeanHunterAnimationId = "idle";
  let stateTime = 0;

  return {
    root: asset.root,
    body: asset.meshes.surface as THREE.SkinnedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>,
    skeleton: asset.skeleton,
    update(state, dt) {
      elapsed += dt;
      if (activeAnimation !== state.animation) {
        activeAnimation = state.animation;
        stateTime = 0;
      } else {
        stateTime += dt;
      }

      resetPose(asset.bones, basePose);

      if (state.animation === "walk") {
        applyWalkPose(asset.bones, elapsed);
      } else if (state.animation === "melee") {
        applyMeleePose(asset.bones, stateTime);
      } else if (state.animation === "death") {
        applyDeathPose(asset.bones, stateTime);
      } else {
        applyIdlePose(asset.bones, elapsed);
      }

      material.emissiveIntensity = 0.1 + (Math.sin(elapsed * 5.5) + 1) * 0.035;
    },
  };
}

function createLeanHunterBones(): BoneDefinition[] {
  const bones: BoneDefinition[] = [
    { name: "motion", position: [0, FLOOR_OFFSET, 0] },
    { name: "body", parent: "motion", position: [0, 0.42, 0] },
    { name: "head", parent: "body", position: [0, 0.01, -0.58] },
    { name: "tail", parent: "body", position: [0, 0.04, 0.58] },
  ];

  for (const leg of LEG_DEFINITIONS) {
    bones.push({ name: `${leg.id}-leg`, parent: "body", position: [leg.x * 0.34, -0.03, leg.z * 0.34] });
  }

  return bones;
}

function createLeanHunterParts(): Array<RigidSkinnedPart<LeanHunterMaterialId>> {
  const parts: Array<RigidSkinnedPart<LeanHunterMaterialId>> = [
    part("body-hull", "body", facetedBodyHullGeometry(0.86, 0.46, 1.22, ATLAS.darkPlate), [0, 0, 0], 0xa9b4b5),
    part("sensor-head", "head", tetraGeometry(0.36, 0.22, 0.42, ATLAS.redOptic), [0, 0, -0.08], 0xc0aaa4),
    part("left-red-optic", "head", tetraGeometry(0.07, 0.05, 0.06, ATLAS.redOptic), [-0.08, 0.01, -0.27], 0xff5a4f),
    part("right-red-optic", "head", tetraGeometry(0.07, 0.05, 0.06, ATLAS.redOptic), [0.08, 0.01, -0.27], 0xff5a4f),
    part("rear-core", "tail", tetraGeometry(0.32, 0.28, 0.36, ATLAS.greenCore), [0, 0, 0.06], 0x94b49f),
    part("front-dorsal-blade", "body", tetraGeometry(0.12, 0.26, 0.22, ATLAS.cyanStrip), [0, 0.22, -0.18], 0x93d4d8),
    part("rear-dorsal-blade", "body", tetraGeometry(0.12, 0.28, 0.24, ATLAS.cyanStrip), [0, 0.24, 0.18], 0x93d4d8),
  ];

  for (const leg of LEG_DEFINITIONS) {
    const isRearLeg = leg.z > 0;
    const yaw = isRearLeg ? leg.x * 1.0 : Math.atan2(leg.x * 0.82, leg.z);
    const pitch = isRearLeg ? 0.92 : -0.34;
    const roll = leg.x * (isRearLeg ? -0.08 : -0.2);
    parts.push(
      part(
        `${leg.id}-blade-leg`,
        `${leg.id}-leg`,
        connectedBladeLegGeometry(0.18, 0.15, isRearLeg ? 0.78 : 0.86, 0.24, ATLAS.scratchedPlate, ATLAS.blade),
        [0, isRearLeg ? -0.12 : -0.06, 0],
        0x879293,
        [pitch, yaw, roll],
      ),
    );
  }

  return parts;
}

function applyIdlePose(bones: Record<string, THREE.Bone>, elapsed: number): void {
  const breathe = Math.sin(elapsed * 2.4);
  const bodyBob = 0.026 * breathe;
  bones.body.position.y += bodyBob;
  bones.body.rotation.x = 0.012 * breathe;
  bones.head.rotation.x = -0.05 + 0.04 * Math.sin(elapsed * 1.7);
  bones.tail.rotation.x = -0.06 * breathe;

  for (const leg of LEG_DEFINITIONS) {
    const settle = Math.sin(elapsed * 2 + leg.phase) * 0.04;
    bones[`${leg.id}-leg`].position.y -= bodyBob;
    bones[`${leg.id}-leg`].rotation.x = settle;
    bones[`${leg.id}-leg`].rotation.y = leg.x * settle * 0.45;
  }
}

function applyWalkPose(bones: Record<string, THREE.Bone>, elapsed: number): void {
  const strideTime = elapsed * 8.4;
  const lift = Math.abs(Math.sin(strideTime));
  bones.motion.position.y = FLOOR_OFFSET + 0.03 + lift * 0.035;
  bones.body.rotation.z = Math.sin(strideTime) * 0.04;
  bones.head.rotation.x = -0.12 + Math.sin(strideTime * 0.5) * 0.035;
  bones.tail.rotation.x = Math.sin(strideTime * 0.6) * 0.08;

  for (const leg of LEG_DEFINITIONS) {
    const step = Math.sin(strideTime + leg.phase);
    const rise = Math.max(0, step);
    bones[`${leg.id}-leg`].rotation.x = step * 0.34 - rise * 0.16;
    bones[`${leg.id}-leg`].rotation.y = leg.x * step * 0.18;
    bones[`${leg.id}-leg`].rotation.z = leg.x * rise * 0.16;
  }
}

function applyMeleePose(bones: Record<string, THREE.Bone>, stateTime: number): void {
  const cycle = (stateTime % 0.9) / 0.9;
  const windup = smoothPulse(cycle, 0.05, 0.34);
  const slash = smoothPulse(cycle, 0.34, 0.58);
  const recover = smoothPulse(cycle, 0.58, 1);
  const thrust = slash * (1 - recover * 0.45);

  bones.motion.position.z = -0.18 * thrust + 0.06 * windup;
  bones.motion.position.y = FLOOR_OFFSET + 0.02 + 0.08 * thrust;
  bones.body.rotation.x = -0.2 * thrust + 0.08 * windup;
  bones.head.rotation.x = -0.48 * thrust + 0.14 * windup;

  for (const leg of LEG_DEFINITIONS) {
    const front = leg.z < 0 ? 1 : -1;
    bones[`${leg.id}-leg`].rotation.x = front * (0.42 * thrust - 0.22 * windup);
    bones[`${leg.id}-leg`].rotation.y = leg.x * (0.2 * thrust + 0.12 * windup);
    bones[`${leg.id}-leg`].rotation.z = leg.x * 0.2 * thrust;
  }
}

function applyDeathPose(bones: Record<string, THREE.Bone>, stateTime: number): void {
  const fall = THREE.MathUtils.smoothstep(Math.min(stateTime / 0.95, 1), 0, 1);
  const twitch = Math.sin(stateTime * 31) * (1 - fall) * 0.18;

  bones.motion.position.y = FLOOR_OFFSET - 0.23 * fall;
  bones.motion.rotation.z = -0.7 * fall;
  bones.motion.rotation.x = 0.26 * fall;
  bones.body.rotation.z = -0.42 * fall + twitch;
  bones.head.rotation.x = 0.62 * fall;
  bones.tail.rotation.x = -0.5 * fall;

  for (const leg of LEG_DEFINITIONS) {
    bones[`${leg.id}-leg`].rotation.x = leg.z * (0.62 * fall + twitch * 0.35);
    bones[`${leg.id}-leg`].rotation.y = leg.x * (0.42 * fall);
    bones[`${leg.id}-leg`].rotation.z = leg.x * -0.48 * fall;
  }
}

function smoothPulse(value: number, start: number, end: number): number {
  if (value <= start || value >= end) return 0;
  const midpoint = (start + end) * 0.5;
  if (value < midpoint) return THREE.MathUtils.smoothstep(value, start, midpoint);
  return 1 - THREE.MathUtils.smoothstep(value, midpoint, end);
}

function createSurfaceMaterial(
  texture: THREE.Texture,
  rimColor: THREE.ColorRepresentation = 0x32f4ff,
  rimStrength = 0.13,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    vertexColors: true,
    roughness: 0.58,
    metalness: 0.82,
    color: 0xffffff,
    emissive: new THREE.Color(0x0e2629),
    emissiveMap: texture,
    emissiveIntensity: 0.12,
    side: THREE.DoubleSide,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.hunterRimColor = { value: new THREE.Color(rimColor) };
    shader.uniforms.hunterRimStrength = { value: rimStrength };
    shader.fragmentShader = shader.fragmentShader.replace(
      "void main() {",
      `
      uniform vec3 hunterRimColor;
      uniform float hunterRimStrength;

      void main() {
      `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `
      #include <emissivemap_fragment>
      float hunterRim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.4);
      totalEmissiveRadiance += hunterRimColor * hunterRim * hunterRimStrength;
      `,
    );
  };
  material.customProgramCacheKey = () => "hunter-surface";

  return material;
}

function part(
  name: string,
  bone: string,
  geometry: THREE.BufferGeometry,
  position: Vector3Tuple,
  color: THREE.ColorRepresentation,
  rotation?: Vector3Tuple,
): RigidSkinnedPart<LeanHunterMaterialId> {
  return { name, bone, material: "surface", geometry, position, rotation, color };
}

function facetedBodyHullGeometry(width: number, height: number, length: number, uvRect: AtlasRect): THREE.BufferGeometry {
  const x = width * 0.5;
  const y = height * 0.5;
  const z = length * 0.5;
  const bottomFrontLeft: Vector3Tuple = [-x * 0.78, -y, -z * 0.88];
  const bottomFrontRight: Vector3Tuple = [x * 0.78, -y, -z * 0.88];
  const bottomRearLeft: Vector3Tuple = [-x, -y * 0.82, z * 0.82];
  const bottomRearRight: Vector3Tuple = [x, -y * 0.82, z * 0.82];
  const topFront: Vector3Tuple = [0, y * 0.88, -z];
  const topMid: Vector3Tuple = [0, y * 1.18, -z * 0.08];
  const topRear: Vector3Tuple = [0, y * 0.72, z * 0.94];
  const leftMid: Vector3Tuple = [-x * 0.95, -y * 0.08, -z * 0.02];
  const rightMid: Vector3Tuple = [x * 0.95, -y * 0.08, -z * 0.02];

  return geometryFromTriangles(
    [
      [bottomFrontLeft, bottomRearLeft, bottomRearRight],
      [bottomFrontLeft, bottomRearRight, bottomFrontRight],
      [bottomFrontLeft, bottomFrontRight, topFront],
      [bottomRearLeft, topRear, bottomRearRight],
      [bottomFrontLeft, topFront, leftMid],
      [bottomFrontLeft, leftMid, bottomRearLeft],
      [leftMid, topFront, topMid],
      [leftMid, topMid, topRear],
      [leftMid, topRear, bottomRearLeft],
      [bottomFrontRight, rightMid, topFront],
      [bottomFrontRight, bottomRearRight, rightMid],
      [rightMid, topMid, topFront],
      [rightMid, topRear, topMid],
      [rightMid, bottomRearRight, topRear],
    ],
    uvRect,
  );
}

function connectedBladeLegGeometry(
  width: number,
  height: number,
  length: number,
  spikeLength: number,
  bodyUvRect: AtlasRect,
  spikeUvRect: AtlasRect,
): THREE.BufferGeometry {
  const baseWidth = width * 1.38;
  const y = height * 0.5;
  const base = legSection(0, 0, baseWidth, height);
  const elbow = legSection(length * 0.48, -height * 0.08, width * 0.92, height * 0.82);
  const toe = legSection(length * 0.72, -height * 1.42, width * 0.48, height * 0.72);
  const shoulderPeak: Vector3Tuple = [0, y * 1.24, length * 0.1];
  const kneePeak: Vector3Tuple = [0, y * 0.72, length * 0.48];
  const shinRidge: Vector3Tuple = [0, -height * 0.82, length * 0.63];
  const spikeTip: Vector3Tuple = [0, -height * 2.32, length * 0.82 + spikeLength * 0.26];

  return geometryFromTriangleGroups([
    {
      uvRect: bodyUvRect,
      triangles: [
        ...segmentTriangles(base, elbow),
        ...segmentTriangles(elbow, toe),
        [base.bottomLeft, base.topLeft, base.topRight],
        [base.bottomLeft, base.topRight, base.bottomRight],
        [base.topLeft, shoulderPeak, base.topRight],
        [base.topLeft, kneePeak, shoulderPeak],
        [base.topRight, shoulderPeak, kneePeak],
        [elbow.topLeft, shinRidge, elbow.topRight],
        [elbow.topLeft, toe.topLeft, shinRidge],
        [elbow.topRight, shinRidge, toe.topRight],
      ],
    },
    {
      uvRect: spikeUvRect,
      triangles: [
        [toe.topLeft, toe.bottomLeft, spikeTip],
        [toe.bottomLeft, toe.bottomRight, spikeTip],
        [toe.bottomRight, toe.topRight, spikeTip],
        [toe.topRight, toe.topLeft, spikeTip],
      ],
    },
  ]);
}

function legSection(
  z: number,
  centerY: number,
  width: number,
  height: number,
): { topLeft: Vector3Tuple; topRight: Vector3Tuple; bottomLeft: Vector3Tuple; bottomRight: Vector3Tuple } {
  const x = width * 0.5;
  const y = height * 0.5;
  return {
    topLeft: [-x, centerY + y, z],
    topRight: [x, centerY + y, z],
    bottomLeft: [-x, centerY - y, z],
    bottomRight: [x, centerY - y, z],
  };
}

function segmentTriangles(
  start: ReturnType<typeof legSection>,
  end: ReturnType<typeof legSection>,
): Array<[Vector3Tuple, Vector3Tuple, Vector3Tuple]> {
  return [
    [start.topLeft, end.topLeft, end.topRight],
    [start.topLeft, end.topRight, start.topRight],
    [start.bottomLeft, start.bottomRight, end.bottomRight],
    [start.bottomLeft, end.bottomRight, end.bottomLeft],
    [start.topLeft, start.bottomLeft, end.bottomLeft],
    [start.topLeft, end.bottomLeft, end.topLeft],
    [start.bottomRight, start.topRight, end.topRight],
    [start.bottomRight, end.topRight, end.bottomRight],
  ];
}

function tetraGeometry(width: number, height: number, length: number, uvRect: AtlasRect): THREE.BufferGeometry {
  const x = width * 0.5;
  const y = height * 0.5;
  const z = length * 0.5;
  const top: Vector3Tuple = [0, y, 0];
  const left: Vector3Tuple = [-x, -y, -z];
  const right: Vector3Tuple = [x, -y, -z];
  const tip: Vector3Tuple = [0, -y * 0.25, z];

  return geometryFromTriangles(
    [
      [top, left, right],
      [top, tip, left],
      [top, right, tip],
      [left, tip, right],
    ],
    uvRect,
  );
}

function geometryFromTriangles(triangles: Array<[Vector3Tuple, Vector3Tuple, Vector3Tuple]>, uvRect: AtlasRect): THREE.BufferGeometry {
  return geometryFromTriangleGroups([{ triangles, uvRect }]);
}

function geometryFromTriangleGroups(
  groups: Array<{ triangles: Array<[Vector3Tuple, Vector3Tuple, Vector3Tuple]>; uvRect: AtlasRect }>,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];

  for (const group of groups) {
    const [u0, v0, u1, v1] = group.uvRect;
    const triangleUv: Array<[number, number]> = [
      [u0, v1],
      [u1, v1],
      [(u0 + u1) * 0.5, v0],
    ];

    for (const triangle of group.triangles) {
      for (let index = 0; index < 3; index += 1) {
        positions.push(...triangle[index]);
        uvs.push(...triangleUv[index]);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function captureBasePose(bones: Record<string, THREE.Bone>): Record<string, BoneSnapshot> {
  return Object.fromEntries(
    Object.entries(bones).map(([name, bone]) => [
      name,
      {
        position: bone.position.clone(),
        rotation: bone.rotation.clone(),
      },
    ]),
  );
}

function resetPose(bones: Record<string, THREE.Bone>, basePose: Record<string, BoneSnapshot>): void {
  for (const [name, bone] of Object.entries(bones)) {
    const snapshot = basePose[name];
    bone.position.copy(snapshot.position);
    bone.rotation.copy(snapshot.rotation);
  }
}
