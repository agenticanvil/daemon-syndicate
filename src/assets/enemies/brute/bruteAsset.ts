import * as THREE from "three";
import type { EnemyAssetSettings } from "../../../assetSettings";
import bruteSettings from "./brute.settings.json";

const BRUTE_ATLAS_URL = "/assets/brute-atlas.png";
const FLOOR_OFFSET = 0.04;
const MODEL_FLOOR_LIFT = 0.56;
const BRUTE_SURFACE_CACHE_KEY = "brute-single-connected-surface-v2";
const BONE_NAMES = [
  "motion",
  "body",
  "head",
  "left-arm",
  "left-claw",
  "right-arm",
  "right-claw",
  "left-leg",
  "left-foot",
  "right-leg",
  "right-foot",
  "tail-base",
  "tail-mid",
  "tail-tip",
] as const;

type BruteAnimationId = "idle" | "walk" | "melee" | "death";
type BruteAnimationState = { animation: BruteAnimationId };
type BruteBoneName = (typeof BONE_NAMES)[number];

export type BruteAsset = {
  root: THREE.Group;
  body: THREE.SkinnedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  skeleton: THREE.Skeleton;
  applyBasePose: () => void;
  update: (state: BruteAnimationState, dt: number) => void;
};

type BoneSnapshot = {
  position: THREE.Vector3;
  rotation: THREE.Euler;
};

type Vector3Tuple = [number, number, number];
type AtlasRect = [number, number, number, number];
type BruteGeometryStats = {
  triangles: number;
  boundaryEdges: number;
  connectedComponents: number;
  inwardFacingComponents: number;
};

type GeometryPrimitiveResult = {
  nearest: (point: THREE.Vector3) => number;
};

type BruteGeometryBuildResult = {
  geometry: THREE.BufferGeometry;
  stats: BruteGeometryStats;
};

type VertexDraft = {
  position: THREE.Vector3;
  uv: THREE.Vector2;
  boneIndex: number;
};

const BONE_INDEX = Object.fromEntries(BONE_NAMES.map((name, index) => [name, index])) as Record<BruteBoneName, number>;

const ATLAS = {
  armor: imageAtlasRect(0.02, 0.02, 0.35, 0.58),
  scratchedArmor: imageAtlasRect(0.22, 0.02, 0.48, 0.5),
  headArmor: imageAtlasRect(0.34, 0.02, 0.58, 0.36),
  flesh: imageAtlasRect(0.5, 0.04, 0.78, 0.84),
  greenCore: imageAtlasRect(0.02, 0.62, 0.52, 0.95),
  greenMaw: imageAtlasRect(0.24, 0.64, 0.52, 0.9),
  claw: imageAtlasRect(0.72, 0.42, 0.94, 0.7),
  cable: imageAtlasRect(0.02, 0.84, 0.32, 0.98),
  tail: imageAtlasRect(0.9, 0.02, 0.995, 0.74),
  redSensor: imageAtlasRect(0.74, 0.74, 0.98, 0.98),
  redEye: imageAtlasRect(0.82, 0.76, 0.96, 0.93),
} satisfies Record<string, AtlasRect>;

export const BRUTE_SETTINGS = bruteSettings as EnemyAssetSettings;

let cachedGeometry: THREE.BufferGeometry | undefined;
let cachedStats: BruteGeometryStats | undefined;

export function createBruteAsset(loader: THREE.TextureLoader, anisotropy: number): BruteAsset {
  const atlas = loader.load(BRUTE_ATLAS_URL);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.anisotropy = anisotropy;
  atlas.wrapS = THREE.ClampToEdgeWrapping;
  atlas.wrapT = THREE.ClampToEdgeWrapping;

  const material = createBruteMaterial(atlas);
  const root = new THREE.Group();
  root.name = "brute-rig";

  const bones = createBruteBones();
  root.add(bones.motion);
  root.updateMatrixWorld(true);

  const mesh = new THREE.SkinnedMesh(createBruteGeometry(), material);
  mesh.name = "brute-rig-surface";
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const orderedBones = BONE_NAMES.map((name) => bones[name]);
  const skeleton = new THREE.Skeleton(orderedBones);
  skeleton.calculateInverses();
  mesh.bind(skeleton);
  root.add(mesh);

  const basePose = captureBasePose(bones);
  let elapsed = 0;
  let activeAnimation: BruteAnimationId = "idle";
  let stateTime = 0;

  return {
    root,
    body: mesh,
    skeleton,
    applyBasePose() {
      resetPose(bones, basePose);
      applyIdlePose(bones, 0);
      material.emissiveIntensity = 0.2;
    },
    update(state, dt) {
      elapsed += dt;
      if (activeAnimation !== state.animation) {
        activeAnimation = state.animation;
        stateTime = 0;
      } else {
        stateTime += dt;
      }

      resetPose(bones, basePose);
      if (state.animation === "walk") {
        applyWalkPose(bones, elapsed);
      } else if (state.animation === "melee") {
        applyMeleePose(bones, stateTime);
      } else if (state.animation === "death") {
        applyDeathPose(bones, stateTime);
      } else {
        applyIdlePose(bones, elapsed);
      }

      material.emissiveIntensity = 0.16 + (Math.sin(elapsed * 4.2) + 1) * 0.04;
    },
  };
}

export function createBruteGeometry(): THREE.BufferGeometry {
  if (!cachedGeometry) {
    const result = buildBruteGeometry();
    cachedGeometry = result.geometry;
    cachedStats = result.stats;
  }
  return cachedGeometry;
}

export function getBruteGeometryStats(): BruteGeometryStats {
  if (!cachedStats) createBruteGeometry();
  return { ...(cachedStats as BruteGeometryStats) };
}

function createBruteMaterial(texture: THREE.Texture): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    emissiveMap: texture,
    color: 0xffffff,
    emissive: new THREE.Color(0x16331f),
    emissiveIntensity: 0.2,
    roughness: 0.66,
    metalness: 0.72,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.bruteRimColor = { value: new THREE.Color(0x51eaff) };
    shader.uniforms.bruteRimStrength = { value: 0.15 };
    shader.fragmentShader = shader.fragmentShader.replace(
      "void main() {",
      `
      uniform vec3 bruteRimColor;
      uniform float bruteRimStrength;

      void main() {
      `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `
      #include <emissivemap_fragment>
      #ifdef USE_EMISSIVEMAP
        vec3 bruteGlowSample = texture2D(emissiveMap, vEmissiveMapUv).rgb;
        float bruteGreenGlow = smoothstep(0.28, 0.78, bruteGlowSample.g - max(bruteGlowSample.r, bruteGlowSample.b) * 0.22);
        float bruteRedGlow = smoothstep(0.3, 0.82, bruteGlowSample.r - max(bruteGlowSample.g, bruteGlowSample.b) * 0.2);
        totalEmissiveRadiance += bruteGlowSample * (bruteGreenGlow * 0.28 + bruteRedGlow * 0.5);
      #endif
      float bruteRim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.2);
      totalEmissiveRadiance += bruteRimColor * bruteRim * bruteRimStrength;
      `,
    );
  };
  material.customProgramCacheKey = () => BRUTE_SURFACE_CACHE_KEY;

  return material;
}

function createBruteBones(): Record<BruteBoneName, THREE.Bone> {
  const bones = Object.fromEntries(
    BONE_NAMES.map((name) => {
      const bone = new THREE.Bone();
      bone.name = name;
      return [name, bone];
    }),
  ) as Record<BruteBoneName, THREE.Bone>;

  bones.motion.position.set(0, FLOOR_OFFSET, 0);
  bones.body.position.set(0, 0.98 + MODEL_FLOOR_LIFT, 0);
  bones.head.position.set(0, 0.5, -0.28);
  bones["left-arm"].position.set(-0.46, 0.2, -0.06);
  bones["left-claw"].position.set(-0.74, -0.04, -0.16);
  bones["right-arm"].position.set(0.46, 0.2, -0.06);
  bones["right-claw"].position.set(0.74, -0.04, -0.16);
  bones["left-leg"].position.set(-0.28, -0.55, 0.08);
  bones["left-foot"].position.set(0, -0.64, -0.12);
  bones["right-leg"].position.set(0.28, -0.55, 0.08);
  bones["right-foot"].position.set(0, -0.64, -0.12);
  bones["tail-base"].position.set(0, -0.34, 0.34);
  bones["tail-mid"].position.set(0.18, -0.34, 0.66);
  bones["tail-tip"].position.set(0.28, -0.12, 0.58);

  bones.motion.add(bones.body);
  bones.body.add(
    bones.head,
    bones["left-arm"],
    bones["right-arm"],
    bones["left-leg"],
    bones["right-leg"],
    bones["tail-base"],
  );
  bones["left-arm"].add(bones["left-claw"]);
  bones["right-arm"].add(bones["right-claw"]);
  bones["left-leg"].add(bones["left-foot"]);
  bones["right-leg"].add(bones["right-foot"]);
  bones["tail-base"].add(bones["tail-mid"]);
  bones["tail-mid"].add(bones["tail-tip"]);

  return bones;
}

function applyIdlePose(bones: Record<BruteBoneName, THREE.Bone>, elapsed: number): void {
  const breathe = Math.sin(elapsed * 1.8);
  bones.motion.position.y = FLOOR_OFFSET + breathe * 0.018;
  bones.body.rotation.x = -0.05 + breathe * 0.018;
  bones.head.rotation.x = -0.08 + Math.sin(elapsed * 1.3) * 0.025;
  bones["left-arm"].rotation.z = -0.08 + breathe * 0.035;
  bones["right-arm"].rotation.z = 0.08 - breathe * 0.035;
  bones["left-claw"].rotation.y = 0.08 + Math.sin(elapsed * 1.6) * 0.04;
  bones["right-claw"].rotation.y = -0.08 - Math.sin(elapsed * 1.6) * 0.04;
  bones["tail-base"].rotation.y = Math.sin(elapsed * 1.4) * 0.12;
  bones["tail-mid"].rotation.y = Math.sin(elapsed * 1.4 + 0.7) * 0.16;
  bones["tail-tip"].rotation.y = Math.sin(elapsed * 1.4 + 1.3) * 0.18;
}

function applyWalkPose(bones: Record<BruteBoneName, THREE.Bone>, elapsed: number): void {
  const stride = elapsed * 5.4;
  const left = Math.sin(stride);
  const right = Math.sin(stride + Math.PI);
  bones.motion.position.y = FLOOR_OFFSET + 0.03 + Math.abs(left) * 0.035;
  bones.body.rotation.z = left * 0.035;
  bones.body.rotation.x = -0.08 + Math.sin(stride * 0.5) * 0.035;
  bones.head.rotation.x = -0.14 + Math.sin(stride) * 0.025;
  bones["left-arm"].rotation.x = -0.18 + right * 0.22;
  bones["right-arm"].rotation.x = -0.18 + left * 0.22;
  bones["left-claw"].rotation.z = -0.12 + right * 0.08;
  bones["right-claw"].rotation.z = 0.12 - left * 0.08;
  bones["left-leg"].rotation.x = left * 0.36;
  bones["right-leg"].rotation.x = right * 0.36;
  bones["left-foot"].rotation.x = -0.16 + Math.max(0, -left) * 0.24;
  bones["right-foot"].rotation.x = -0.16 + Math.max(0, -right) * 0.24;
  bones["tail-base"].rotation.y = -left * 0.12;
  bones["tail-mid"].rotation.y = -left * 0.22;
  bones["tail-tip"].rotation.y = -left * 0.28;
}

function applyMeleePose(bones: Record<BruteBoneName, THREE.Bone>, stateTime: number): void {
  const cycle = (stateTime % 1.16) / 1.16;
  const windup = smoothPulse(cycle, 0.04, 0.34);
  const slash = smoothPulse(cycle, 0.34, 0.58);
  const recover = smoothPulse(cycle, 0.58, 1);
  const strike = slash * (1 - recover * 0.3);

  bones.motion.position.z = -0.16 * strike + 0.05 * windup;
  bones.motion.position.y = FLOOR_OFFSET + 0.04 + 0.06 * strike;
  bones.body.rotation.x = -0.18 * strike + 0.08 * windup;
  bones.head.rotation.x = -0.28 * strike + 0.1 * windup;
  bones["left-arm"].rotation.x = -0.52 * strike + 0.28 * windup;
  bones["left-arm"].rotation.y = -0.38 * strike;
  bones["left-claw"].rotation.y = -0.52 * strike + 0.22 * windup;
  bones["right-arm"].rotation.x = -0.42 * strike + 0.18 * windup;
  bones["right-arm"].rotation.y = 0.32 * strike;
  bones["right-claw"].rotation.y = 0.48 * strike - 0.18 * windup;
  bones["left-leg"].rotation.x = -0.16 * strike;
  bones["right-leg"].rotation.x = 0.2 * strike;
  bones["tail-base"].rotation.y = 0.18 * windup - 0.24 * strike;
  bones["tail-mid"].rotation.y = 0.28 * windup - 0.32 * strike;
  bones["tail-tip"].rotation.y = 0.36 * windup - 0.4 * strike;
}

function applyDeathPose(bones: Record<BruteBoneName, THREE.Bone>, stateTime: number): void {
  const fall = THREE.MathUtils.smoothstep(Math.min(stateTime / 1.25, 1), 0, 1);
  const twitch = Math.sin(stateTime * 27) * (1 - fall) * 0.14;
  bones.motion.position.y = FLOOR_OFFSET - 0.34 * fall;
  bones.motion.rotation.z = -0.78 * fall;
  bones.motion.rotation.x = 0.36 * fall;
  bones.body.rotation.z = -0.32 * fall + twitch;
  bones.head.rotation.x = 0.5 * fall;
  bones["left-arm"].rotation.z = -0.52 * fall;
  bones["right-arm"].rotation.z = 0.46 * fall;
  bones["left-claw"].rotation.y = -0.7 * fall;
  bones["right-claw"].rotation.y = 0.64 * fall;
  bones["left-leg"].rotation.x = 0.6 * fall;
  bones["right-leg"].rotation.x = -0.42 * fall;
  bones["tail-base"].rotation.y = -0.46 * fall;
  bones["tail-mid"].rotation.y = -0.62 * fall;
  bones["tail-tip"].rotation.y = -0.84 * fall;
}

function smoothPulse(value: number, start: number, end: number): number {
  if (value <= start || value >= end) return 0;
  const midpoint = (start + end) * 0.5;
  if (value < midpoint) return THREE.MathUtils.smoothstep(value, start, midpoint);
  return 1 - THREE.MathUtils.smoothstep(value, midpoint, end);
}

function buildBruteGeometry(): BruteGeometryBuildResult {
  const builder = new BruteGeometryBuilder();
  const body = builder.addEllipsoid({
    center: [0, 0.98, -0.02],
    radii: [0.45, 0.64, 0.34],
    latSegments: 6,
    radialSegments: 8,
    uvRect: ATLAS.armor,
    bone: "body",
  });
  const abdomen = builder.addEllipsoid({
    center: [0, 0.68, -0.02],
    radii: [0.34, 0.46, 0.28],
    latSegments: 5,
    radialSegments: 8,
    uvRect: ATLAS.greenCore,
    bone: "body",
  });
  const head = builder.addEllipsoid({
    center: [0, 1.48, -0.3],
    radii: [0.24, 0.24, 0.3],
    latSegments: 5,
    radialSegments: 7,
    uvRect: ATLAS.headArmor,
    bone: "head",
  });
  const mawGlow = builder.addEllipsoid({
    center: [0, 1.34, -0.57],
    radii: [0.15, 0.16, 0.035],
    latSegments: 4,
    radialSegments: 6,
    uvRect: ATLAS.greenMaw,
    bone: "head",
  });
  const leftEye = builder.addEllipsoid({
    center: [-0.23, 1.47, -0.43],
    radii: [0.032, 0.042, 0.045],
    latSegments: 3,
    radialSegments: 5,
    uvRect: ATLAS.redEye,
    bone: "head",
  });
  const rightEye = builder.addEllipsoid({
    center: [0.23, 1.47, -0.43],
    radii: [0.032, 0.042, 0.045],
    latSegments: 3,
    radialSegments: 5,
    uvRect: ATLAS.redEye,
    bone: "head",
  });
  builder.connect(body.nearest(new THREE.Vector3(0, 1.4, -0.18)), head.nearest(new THREE.Vector3(0, 1.28, -0.18)), ATLAS.cable, "body");
  builder.connect(head.nearest(new THREE.Vector3(0, 1.34, -0.45)), mawGlow.nearest(new THREE.Vector3(0, 1.34, -0.53)), ATLAS.greenMaw, "head");
  builder.connect(head.nearest(new THREE.Vector3(-0.18, 1.47, -0.4)), leftEye.nearest(new THREE.Vector3(-0.21, 1.47, -0.42)), ATLAS.redEye, "head");
  builder.connect(head.nearest(new THREE.Vector3(0.18, 1.47, -0.4)), rightEye.nearest(new THREE.Vector3(0.21, 1.47, -0.42)), ATLAS.redEye, "head");
  builder.connect(body.nearest(new THREE.Vector3(0, 0.76, -0.02)), abdomen.nearest(new THREE.Vector3(0, 0.92, -0.02)), ATLAS.greenCore, "body");

  for (const side of [-1, 1] as const) {
    const armBone: BruteBoneName = side < 0 ? "left-arm" : "right-arm";
    const clawBone: BruteBoneName = side < 0 ? "left-claw" : "right-claw";
    const shoulder = builder.addEllipsoid({
      center: [side * 0.5, 1.3, -0.06],
      radii: [0.22, 0.18, 0.22],
      latSegments: 4,
      radialSegments: 7,
      uvRect: ATLAS.armor,
      bone: armBone,
    });
    const upperArm = builder.addTube({
      points: [
        [side * 0.48, 1.2, -0.08],
        [side * 0.78, 1.08, -0.18],
        [side * 1.02, 0.98, -0.28],
      ],
      radii: [0.14, 0.13, 0.12],
      radialSegments: 6,
      uvRect: ATLAS.flesh,
      boneForRing: () => armBone,
    });
    const forearm = builder.addTube({
      points: [
        [side * 1.0, 0.96, -0.28],
        [side * 1.28, 0.88, -0.44],
        [side * 1.48, 0.82, -0.64],
      ],
      radii: [0.18, 0.21, 0.17],
      radialSegments: 6,
      uvRect: ATLAS.scratchedArmor,
      boneForRing: () => clawBone,
    });
    const upperClaw = builder.addBlade({
      base: [side * 1.4, 0.86, -0.62],
      mid: [side * 1.58, 0.96, -0.82],
      tip: [side * 1.76, 0.9, -1.02],
      width: 0.16,
      thickness: 0.06,
      side,
      uvRect: ATLAS.claw,
      bone: clawBone,
    });
    const lowerClaw = builder.addBlade({
      base: [side * 1.42, 0.72, -0.58],
      mid: [side * 1.6, 0.62, -0.78],
      tip: [side * 1.74, 0.58, -0.98],
      width: 0.13,
      thickness: 0.05,
      side,
      uvRect: ATLAS.claw,
      bone: clawBone,
    });
    builder.connect(body.nearest(new THREE.Vector3(side * 0.38, 1.18, -0.05)), shoulder.nearest(new THREE.Vector3(side * 0.34, 1.22, -0.08)), ATLAS.armor, "body");
    builder.connect(shoulder.nearest(new THREE.Vector3(side * 0.58, 1.16, -0.1)), upperArm.start, ATLAS.flesh, armBone);
    builder.connect(upperArm.end, forearm.start, ATLAS.scratchedArmor, clawBone);
    builder.connect(forearm.end, upperClaw.base, ATLAS.claw, clawBone);
    builder.connect(forearm.end, lowerClaw.base, ATLAS.claw, clawBone);
  }

  for (const side of [-1, 1] as const) {
    const legBone: BruteBoneName = side < 0 ? "left-leg" : "right-leg";
    const footBone: BruteBoneName = side < 0 ? "left-foot" : "right-foot";
    const thigh = builder.addTube({
      points: [
        [side * 0.23, 0.52, 0.08],
        [side * 0.33, 0.24, 0.0],
        [side * 0.28, 0.0, -0.05],
      ],
      radii: [0.16, 0.17, 0.13],
      radialSegments: 6,
      uvRect: ATLAS.flesh,
      boneForRing: () => legBone,
    });
    const shin = builder.addTube({
      points: [
        [side * 0.28, 0.02, -0.04],
        [side * 0.3, -0.24, -0.12],
        [side * 0.34, -0.42, -0.28],
      ],
      radii: [0.14, 0.13, 0.11],
      radialSegments: 6,
      uvRect: ATLAS.scratchedArmor,
      boneForRing: () => footBone,
    });
    const foot = builder.addBlade({
      base: [side * 0.34, -0.43, -0.27],
      mid: [side * 0.35, -0.48, -0.48],
      tip: [side * 0.36, -0.42, -0.72],
      width: 0.16,
      thickness: 0.08,
      side,
      uvRect: ATLAS.claw,
      bone: footBone,
    });
    builder.connect(abdomen.nearest(new THREE.Vector3(side * 0.22, 0.48, 0.06)), thigh.start, ATLAS.flesh, legBone);
    builder.connect(thigh.end, shin.start, ATLAS.scratchedArmor, footBone);
    builder.connect(shin.end, foot.base, ATLAS.claw, footBone);
  }

  const tail = builder.addTube({
    points: [
      [0, 0.52, 0.28],
      [0.02, 0.34, 0.55],
      [0.16, 0.22, 0.82],
      [0.34, 0.22, 1.02],
      [0.5, 0.34, 1.04],
      [0.56, 0.5, 0.88],
      [0.5, 0.58, 0.68],
    ],
    radii: [0.12, 0.115, 0.105, 0.092, 0.078, 0.062, 0.03],
    radialSegments: 7,
    uvRect: ATLAS.tail,
    boneForRing: (ring) => (ring < 2 ? "tail-base" : ring < 5 ? "tail-mid" : "tail-tip"),
  });
  builder.connect(body.nearest(new THREE.Vector3(0, 0.66, 0.24)), tail.start, ATLAS.tail, "tail-base");

  return builder.build();
}

class BruteGeometryBuilder {
  private readonly vertices: VertexDraft[] = [];
  private readonly indices: number[] = [];

  addEllipsoid(options: {
    center: Vector3Tuple;
    radii: Vector3Tuple;
    latSegments: number;
    radialSegments: number;
    uvRect: AtlasRect;
    bone: BruteBoneName;
  }): GeometryPrimitiveResult {
    const center = new THREE.Vector3().fromArray(options.center);
    const radii = new THREE.Vector3().fromArray(options.radii);
    const top = this.addVertex(
      center.clone().add(new THREE.Vector3(0, radii.y, 0)),
      uvInRect(options.uvRect, 0.5, 0),
      options.bone,
    );
    const rings: number[][] = [];
    for (let lat = 1; lat < options.latSegments; lat += 1) {
      const phi = (lat / options.latSegments) * Math.PI;
      const ring: number[] = [];
      for (let side = 0; side < options.radialSegments; side += 1) {
        const theta = (side / options.radialSegments) * Math.PI * 2;
        const position = center.clone().add(
          new THREE.Vector3(
            Math.cos(theta) * Math.sin(phi) * radii.x,
            Math.cos(phi) * radii.y,
            Math.sin(theta) * Math.sin(phi) * radii.z,
          ),
        );
        ring.push(this.addVertex(position, uvInRect(options.uvRect, side / options.radialSegments, lat / options.latSegments), options.bone));
      }
      rings.push(ring);
    }
    const bottom = this.addVertex(
      center.clone().add(new THREE.Vector3(0, -radii.y, 0)),
      uvInRect(options.uvRect, 0.5, 1),
      options.bone,
    );

    const first = rings[0];
    const last = rings[rings.length - 1];
    for (let side = 0; side < options.radialSegments; side += 1) {
      const next = (side + 1) % options.radialSegments;
      this.addTriangleFacingAway(top, first[next], first[side], center);
      this.addTriangleFacingAway(bottom, last[side], last[next], center);
    }
    for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex += 1) {
      const a = rings[ringIndex];
      const b = rings[ringIndex + 1];
      for (let side = 0; side < options.radialSegments; side += 1) {
        const next = (side + 1) % options.radialSegments;
        this.addTriangleFacingAway(a[side], b[side], b[next], center);
        this.addTriangleFacingAway(a[side], b[next], a[next], center);
      }
    }

    return { nearest: (point) => this.nearestVertex(point, [...rings.flat(), top, bottom]) };
  }

  addTube(options: {
    points: Vector3Tuple[];
    radii: number[];
    radialSegments: number;
    uvRect: AtlasRect;
    boneForRing: (ring: number) => BruteBoneName;
  }): { start: number; end: number } {
    const points = options.points.map((point) => new THREE.Vector3().fromArray(point));
    const rings: number[][] = [];
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      const previous = points[Math.max(0, pointIndex - 1)];
      const next = points[Math.min(points.length - 1, pointIndex + 1)];
      const tangent = next.clone().sub(previous).normalize();
      const frame = tubeFrame(tangent);
      const ring: number[] = [];
      for (let side = 0; side < options.radialSegments; side += 1) {
        const theta = (side / options.radialSegments) * Math.PI * 2;
        const normal = frame.x.clone().multiplyScalar(Math.cos(theta)).addScaledVector(frame.y, Math.sin(theta));
        const position = points[pointIndex].clone().addScaledVector(normal, options.radii[pointIndex]);
        ring.push(
          this.addVertex(
            position,
            uvInRect(options.uvRect, side / options.radialSegments, pointIndex / (points.length - 1)),
            options.boneForRing(pointIndex),
          ),
        );
      }
      rings.push(ring);
    }

    for (let pointIndex = 0; pointIndex < rings.length - 1; pointIndex += 1) {
      const a = rings[pointIndex];
      const b = rings[pointIndex + 1];
      for (let side = 0; side < options.radialSegments; side += 1) {
        const next = (side + 1) % options.radialSegments;
        const insidePoint = points[pointIndex].clone().lerp(points[pointIndex + 1], 0.5);
        this.addTriangleFacingAway(a[side], b[side], b[next], insidePoint);
        this.addTriangleFacingAway(a[side], b[next], a[next], insidePoint);
      }
    }

    const start = this.addVertex(points[0].clone(), uvInRect(options.uvRect, 0.5, 0), options.boneForRing(0));
    const endPointIndex = points.length - 1;
    const end = this.addVertex(
      points[endPointIndex].clone(),
      uvInRect(options.uvRect, 0.5, 1),
      options.boneForRing(endPointIndex),
    );
    for (let side = 0; side < options.radialSegments; side += 1) {
      const next = (side + 1) % options.radialSegments;
      this.addTriangleFacingAway(start, rings[0][side], rings[0][next], points[1]);
      this.addTriangleFacingAway(end, rings[endPointIndex][next], rings[endPointIndex][side], points[endPointIndex - 1]);
    }

    return { start, end };
  }

  addBlade(options: {
    base: Vector3Tuple;
    mid: Vector3Tuple;
    tip: Vector3Tuple;
    width: number;
    thickness: number;
    side: -1 | 1;
    uvRect: AtlasRect;
    bone: BruteBoneName;
  }): { base: number } {
    const base = new THREE.Vector3().fromArray(options.base);
    const mid = new THREE.Vector3().fromArray(options.mid);
    const tip = new THREE.Vector3().fromArray(options.tip);
    const out = new THREE.Vector3(options.side, 0, 0).multiplyScalar(options.width);
    const up = new THREE.Vector3(0, options.thickness, 0);
    const insidePoint = base.clone().add(mid).add(tip).multiplyScalar(1 / 3);
    const baseCenter = this.addVertex(base, uvInRect(options.uvRect, 0.5, 0.12), options.bone);
    const b0 = this.addVertex(base.clone().add(out), uvInRect(options.uvRect, 0.1, 0.18), options.bone);
    const b1 = this.addVertex(base.clone().sub(out), uvInRect(options.uvRect, 0.9, 0.18), options.bone);
    const m0 = this.addVertex(mid.clone().addScaledVector(out, 0.72).add(up), uvInRect(options.uvRect, 0.14, 0.58), options.bone);
    const m1 = this.addVertex(mid.clone().sub(out).sub(up), uvInRect(options.uvRect, 0.86, 0.58), options.bone);
    const t = this.addVertex(tip, uvInRect(options.uvRect, 0.5, 0.95), options.bone);

    this.addTriangleFacingAway(baseCenter, b0, m0, insidePoint);
    this.addTriangleFacingAway(baseCenter, m0, t, insidePoint);
    this.addTriangleFacingAway(baseCenter, t, m1, insidePoint);
    this.addTriangleFacingAway(baseCenter, m1, b1, insidePoint);
    this.addTriangleFacingAway(b0, b1, m1, insidePoint);
    this.addTriangleFacingAway(b0, m1, m0, insidePoint);
    this.addTriangleFacingAway(m0, m1, t, insidePoint);
    this.addTriangleFacingAway(b0, baseCenter, b1, insidePoint);

    return { base: baseCenter };
  }

  connect(a: number, b: number, uvRect: AtlasRect, bone: BruteBoneName): void {
    const start = this.vertices[a].position;
    const end = this.vertices[b].position;
    const axis = end.clone().sub(start).normalize();
    const frame = tubeFrame(axis);
    const radius = Math.max(0.018, start.distanceTo(end) * 0.08);
    const c = this.addVertex(
      start.clone().lerp(end, 0.5).addScaledVector(frame.x, radius),
      uvInRect(uvRect, 0.25, 0.5),
      bone,
    );
    const d = this.addVertex(
      start.clone().lerp(end, 0.5).addScaledVector(frame.x, -radius),
      uvInRect(uvRect, 0.75, 0.5),
      bone,
    );
    const insidePoint = start.clone().add(end).add(this.vertices[c].position).add(this.vertices[d].position).multiplyScalar(0.25);
    this.addTriangleFacingAway(a, c, d, insidePoint);
    this.addTriangleFacingAway(b, d, c, insidePoint);
    this.addTriangleFacingAway(a, b, c, insidePoint);
    this.addTriangleFacingAway(a, d, b, insidePoint);
  }

  build(): BruteGeometryBuildResult {
    this.orientClosedComponents();

    const geometry = new THREE.BufferGeometry();
    const positions: number[] = [];
    const uvs: number[] = [];
    const skinIndices: number[] = [];
    const skinWeights: number[] = [];

    for (const vertex of this.vertices) {
      positions.push(vertex.position.x, vertex.position.y, vertex.position.z);
      uvs.push(vertex.uv.x, vertex.uv.y);
      skinIndices.push(vertex.boneIndex, 0, 0, 0);
      skinWeights.push(1, 0, 0, 0);
    }

    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
    geometry.setIndex(this.indices);
    geometry.translate(0, MODEL_FLOOR_LIFT, 0);
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    return { geometry, stats: analyzeGeometry(this.vertices, this.indices) };
  }

  private addVertex(position: THREE.Vector3, uv: THREE.Vector2, bone: BruteBoneName): number {
    const index = this.vertices.length;
    this.vertices.push({ position, uv, boneIndex: BONE_INDEX[bone] });
    return index;
  }

  private addTriangle(a: number, b: number, c: number): void {
    this.indices.push(a, b, c);
  }

  private addTriangleFacingAway(a: number, b: number, c: number, insidePoint: THREE.Vector3): void {
    const vertexA = this.vertices[a].position;
    const vertexB = this.vertices[b].position;
    const vertexC = this.vertices[c].position;
    const normal = new THREE.Vector3().crossVectors(vertexB.clone().sub(vertexA), vertexC.clone().sub(vertexA));
    const triangleCenter = vertexA.clone().add(vertexB).add(vertexC).multiplyScalar(1 / 3);
    if (normal.dot(triangleCenter.sub(insidePoint)) < 0) {
      this.addTriangle(a, c, b);
    } else {
      this.addTriangle(a, b, c);
    }
  }

  private orientClosedComponents(): void {
    const triangles: Array<[number, number, number]> = [];
    const trianglesByEdge = new Map<string, number[]>();
    for (let index = 0; index < this.indices.length; index += 3) {
      const triangleIndex = triangles.length;
      const triangle: [number, number, number] = [this.indices[index], this.indices[index + 1], this.indices[index + 2]];
      triangles.push(triangle);
      for (const [from, to] of [
        [triangle[0], triangle[1]],
        [triangle[1], triangle[2]],
        [triangle[2], triangle[0]],
      ] as const) {
        const key = from < to ? `${from}:${to}` : `${to}:${from}`;
        const edgeTriangles = trianglesByEdge.get(key) ?? [];
        edgeTriangles.push(triangleIndex);
        trianglesByEdge.set(key, edgeTriangles);
      }
    }

    const triangleNeighbors = Array.from({ length: triangles.length }, () => new Set<number>());
    for (const edgeTriangles of trianglesByEdge.values()) {
      if (edgeTriangles.length !== 2) continue;
      const [first, second] = edgeTriangles;
      triangleNeighbors[first].add(second);
      triangleNeighbors[second].add(first);
    }

    const visited = new Set<number>();
    for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex += 1) {
      if (visited.has(triangleIndex)) continue;
      const stack = [triangleIndex];
      const componentTriangles: number[] = [];
      visited.add(triangleIndex);
      while (stack.length > 0) {
        const current = stack.pop() as number;
        componentTriangles.push(current);
        for (const next of triangleNeighbors[current]) {
          if (!visited.has(next)) {
            visited.add(next);
            stack.push(next);
          }
        }
      }

      let signedVolume = 0;
      for (const componentTriangle of componentTriangles) {
        const [a, b, c] = triangles[componentTriangle];
        signedVolume += triangleSignedVolume(
          this.vertices[a].position,
          this.vertices[b].position,
          this.vertices[c].position,
        );
      }

      if (signedVolume < -1e-7) {
        for (const componentTriangle of componentTriangles) {
          const index = componentTriangle * 3;
          const b = this.indices[index + 1];
          this.indices[index + 1] = this.indices[index + 2];
          this.indices[index + 2] = b;
        }
      }
    }
  }

  private nearestVertex(point: THREE.Vector3, candidates: number[]): number {
    let nearest = candidates[0];
    let nearestDistance = Infinity;
    for (const index of candidates) {
      const distance = point.distanceToSquared(this.vertices[index].position);
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    }
    return nearest;
  }
}

function analyzeGeometry(vertices: VertexDraft[], indices: number[]): BruteGeometryStats {
  const vertexCount = vertices.length;
  const edges = new Map<string, number>();
  const adjacency = Array.from({ length: vertexCount }, () => new Set<number>());
  const triangles: Array<[number, number, number]> = [];
  const trianglesByEdge = new Map<string, number[]>();

  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index];
    const b = indices[index + 1];
    const c = indices[index + 2];
    const triangleIndex = triangles.length;
    triangles.push([a, b, c]);
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
      const edgeTriangles = trianglesByEdge.get(key) ?? [];
      edgeTriangles.push(triangleIndex);
      trianglesByEdge.set(key, edgeTriangles);
      adjacency[from].add(to);
      adjacency[to].add(from);
    }
  }

  let connectedComponents = 0;
  const visited = new Set<number>();
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    if (visited.has(vertex)) continue;
    connectedComponents += 1;
    const stack = [vertex];
    visited.add(vertex);
    while (stack.length > 0) {
      const current = stack.pop() as number;
      for (const next of adjacency[current]) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
  }

  return {
    triangles: indices.length / 3,
    boundaryEdges: Array.from(edges.values()).filter((count) => count !== 2).length,
    connectedComponents,
    inwardFacingComponents: countInwardFacingComponents(vertices, triangles, trianglesByEdge),
  };
}

function countInwardFacingComponents(
  vertices: VertexDraft[],
  triangles: Array<[number, number, number]>,
  trianglesByEdge: Map<string, number[]>,
): number {
  const triangleNeighbors = Array.from({ length: triangles.length }, () => new Set<number>());
  for (const edgeTriangles of trianglesByEdge.values()) {
    if (edgeTriangles.length !== 2) continue;
    const [first, second] = edgeTriangles;
    triangleNeighbors[first].add(second);
    triangleNeighbors[second].add(first);
  }

  let inwardFacingComponents = 0;
  const visited = new Set<number>();
  for (let triangleIndex = 0; triangleIndex < triangles.length; triangleIndex += 1) {
    if (visited.has(triangleIndex)) continue;
    const stack = [triangleIndex];
    visited.add(triangleIndex);
    const componentTriangles: number[] = [];
    while (stack.length > 0) {
      const current = stack.pop() as number;
      componentTriangles.push(current);
      for (const next of triangleNeighbors[current]) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }

    let signedVolume = 0;
    for (const componentTriangle of componentTriangles) {
      const [a, b, c] = triangles[componentTriangle];
      signedVolume += triangleSignedVolume(vertices[a].position, vertices[b].position, vertices[c].position);
    }
    if (signedVolume < -1e-7) inwardFacingComponents += 1;
  }

  return inwardFacingComponents;
}

function triangleSignedVolume(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  return a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;
}

function imageAtlasRect(u0: number, imageV0: number, u1: number, imageV1: number): AtlasRect {
  return [u0, 1 - imageV1, u1, 1 - imageV0];
}

function tubeFrame(tangent: THREE.Vector3): { x: THREE.Vector3; y: THREE.Vector3 } {
  const reference = Math.abs(tangent.dot(new THREE.Vector3(0, 1, 0))) > 0.88 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const x = new THREE.Vector3().crossVectors(tangent, reference).normalize();
  const y = new THREE.Vector3().crossVectors(x, tangent).normalize();
  return { x, y };
}

function uvInRect(rect: AtlasRect, u: number, v: number): THREE.Vector2 {
  const [u0, v0, u1, v1] = rect;
  return new THREE.Vector2(THREE.MathUtils.lerp(u0, u1, u), THREE.MathUtils.lerp(v0, v1, v));
}

function captureBasePose(bones: Record<BruteBoneName, THREE.Bone>): Record<BruteBoneName, BoneSnapshot> {
  return Object.fromEntries(
    Object.entries(bones).map(([name, bone]) => [
      name,
      {
        position: bone.position.clone(),
        rotation: bone.rotation.clone(),
      },
    ]),
  ) as Record<BruteBoneName, BoneSnapshot>;
}

function resetPose(bones: Record<BruteBoneName, THREE.Bone>, basePose: Record<BruteBoneName, BoneSnapshot>): void {
  for (const [name, bone] of Object.entries(bones) as Array<[BruteBoneName, THREE.Bone]>) {
    const snapshot = basePose[name];
    bone.position.copy(snapshot.position);
    bone.rotation.copy(snapshot.rotation);
  }
}
