import * as THREE from "three";
import type { EnvironmentAssetSettings } from "../../../assetSettings";
import exitPortalSettings from "./exitPortal.settings.json";

const EXIT_PORTAL_FRAME_ATLAS_URL = "/assets/exit-portal-frame-atlas.png";
const FRAME_WIDTH_SCALE = 1.85;
const FRAME_HEIGHT_SCALE = 1.2;

type AtlasRect = {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
};

type BoxPart = {
  center: [number, number, number];
  size: [number, number, number];
  uv: AtlasRect;
};

export const EXIT_PORTAL_SETTINGS = exitPortalSettings as EnvironmentAssetSettings;

export type ExitPortalAsset = {
  root: THREE.Group;
  frame: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  field: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
};

export function createExitPortalAsset(loader: THREE.TextureLoader, anisotropy: number): ExitPortalAsset {
  const texture = loader.load(EXIT_PORTAL_FRAME_ATLAS_URL);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;

  const frameMaterial = new THREE.MeshStandardMaterial({
    map: texture,
    emissiveMap: texture,
    color: 0xb9c7c7,
    emissive: 0x123c40,
    emissiveIntensity: 0.42,
    roughness: 0.72,
    metalness: 0.68,
  });
  const frame = new THREE.Mesh(createExitPortalFrameGeometry(), frameMaterial);
  frame.name = "exit-portal-frame";
  frame.castShadow = true;
  frame.receiveShadow = true;

  const field = new THREE.Mesh(new THREE.PlaneGeometry(2.72, 2.16, 1, 16), createPortalFieldMaterial());
  field.name = "exit-portal-field";
  field.position.set(0, 1.38, -0.035);
  field.onBeforeRender = () => {
    field.material.uniforms.uTime.value = performance.now() * 0.001;
  };

  const root = new THREE.Group();
  root.name = "exit-portal";
  root.add(frame, field);
  return { root, frame, field };
}

function createPortalFieldMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(0x2fffea) },
      uColorB: { value: new THREE.Color(0x067d91) },
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        vec3 transformed = position;
        transformed.z += sin((uv.y * 10.0) + (uv.x * 4.0)) * 0.018;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying vec2 vUv;

      float band(float value, float width) {
        return smoothstep(width, 0.0, abs(value));
      }

      void main() {
        vec2 uv = vUv;
        float flow = sin((uv.y * 18.0) - (uTime * 2.6) + sin(uv.x * 9.0 + uTime) * 0.8);
        float scan = band(fract((uv.y + uTime * 0.16) * 9.0) - 0.5, 0.16);
        float edge = smoothstep(0.5, 0.15, abs(uv.x - 0.5));
        float core = smoothstep(0.0, 0.48, edge);
        float shimmer = 0.5 + 0.5 * sin((uv.x * 26.0) + (uv.y * 7.0) + (uTime * 3.4));
        float alpha = (0.22 + 0.2 * flow + 0.24 * scan + 0.16 * shimmer) * core;
        vec3 color = mix(uColorB, uColorA, 0.55 + 0.45 * scan) + uColorA * pow(edge, 3.0) * 0.8;
        gl_FragColor = vec4(color, clamp(alpha, 0.12, 0.78));
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function createExitPortalFrameGeometry(): THREE.BufferGeometry {
  const parts: BoxPart[] = [
    box([-0.9, 1.16, 0], [0.34, 2.1, 0.36], rect(0.03, 0.28, 0.14, 0.9)),
    box([0.9, 1.16, 0], [0.34, 2.1, 0.36], rect(0.65, 0.28, 0.76, 0.9)),
    box([0, 2.24, 0], [2.12, 0.36, 0.38], rect(0.22, 0.75, 0.55, 0.96)),
    box([0, 0.16, 0.08], [1.92, 0.32, 0.58], rect(0.02, 0.02, 0.26, 0.2)),
    box([-0.58, 1.2, -0.09], [0.1, 1.58, 0.2], rect(0.9, 0.34, 0.94, 0.84)),
    box([0.58, 1.2, -0.09], [0.1, 1.58, 0.2], rect(0.9, 0.34, 0.94, 0.84)),
    box([0, 1.96, -0.09], [1.18, 0.1, 0.2], rect(0.25, 0.7, 0.55, 0.74)),
    box([0, 0.42, -0.09], [1.14, 0.1, 0.22], rect(0.28, 0.22, 0.48, 0.27)),
    box([-1.07, 0.24, 0.08], [0.44, 0.28, 0.72], rect(0.35, 0.02, 0.45, 0.14)),
    box([1.07, 0.24, 0.08], [0.44, 0.28, 0.72], rect(0.35, 0.02, 0.45, 0.14)),
    box([-1.0, 1.96, 0.02], [0.48, 0.26, 0.44], rect(0.08, 0.82, 0.22, 0.97)),
    box([1.0, 1.96, 0.02], [0.48, 0.26, 0.44], rect(0.58, 0.82, 0.72, 0.97)),
    box([-0.9, 1.17, -0.23], [0.12, 1.55, 0.12], rect(0.86, 0.27, 0.89, 0.84)),
    box([0.9, 1.17, -0.23], [0.12, 1.55, 0.12], rect(0.86, 0.27, 0.89, 0.84)),
    box([-0.73, 2.44, 0], [0.36, 0.14, 0.5], rect(0.16, 0.86, 0.25, 0.94)),
    box([0.73, 2.44, 0], [0.36, 0.14, 0.5], rect(0.16, 0.86, 0.25, 0.94)),
    box([-1.17, 1.16, 0.08], [0.1, 1.46, 0.26], rect(0.83, 0.3, 0.86, 0.84)),
    box([1.17, 1.16, 0.08], [0.1, 1.46, 0.26], rect(0.83, 0.3, 0.86, 0.84)),
    box([-0.38, 0.26, 0.36], [0.34, 0.18, 0.3], rect(0.29, 0.35, 0.37, 0.43)),
    box([0.38, 0.26, 0.36], [0.34, 0.18, 0.3], rect(0.42, 0.35, 0.5, 0.43)),
  ];

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const part of parts) {
    appendBox(positions, normals, uvs, indices, part);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function appendBox(
  positions: number[],
  normals: number[],
  uvs: number[],
  indices: number[],
  part: BoxPart,
): void {
  const [sourceCx, sourceCy, cz] = part.center;
  const [sourceSx, sourceSy, sz] = part.size;
  const cx = sourceCx * FRAME_WIDTH_SCALE;
  const cy = sourceCy * FRAME_HEIGHT_SCALE;
  const sx = sourceSx * FRAME_WIDTH_SCALE;
  const sy = sourceSy * FRAME_HEIGHT_SCALE;
  const minX = cx - sx * 0.5;
  const maxX = cx + sx * 0.5;
  const minY = cy - sy * 0.5;
  const maxY = cy + sy * 0.5;
  const minZ = cz - sz * 0.5;
  const maxZ = cz + sz * 0.5;
  const faces = [
    { normal: [0, 0, 1], corners: [[minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ]] },
    { normal: [0, 0, -1], corners: [[maxX, minY, minZ], [minX, minY, minZ], [minX, maxY, minZ], [maxX, maxY, minZ]] },
    { normal: [1, 0, 0], corners: [[maxX, minY, maxZ], [maxX, minY, minZ], [maxX, maxY, minZ], [maxX, maxY, maxZ]] },
    { normal: [-1, 0, 0], corners: [[minX, minY, minZ], [minX, minY, maxZ], [minX, maxY, maxZ], [minX, maxY, minZ]] },
    { normal: [0, 1, 0], corners: [[minX, maxY, maxZ], [maxX, maxY, maxZ], [maxX, maxY, minZ], [minX, maxY, minZ]] },
    { normal: [0, -1, 0], corners: [[minX, minY, minZ], [maxX, minY, minZ], [maxX, minY, maxZ], [minX, minY, maxZ]] },
  ] as const;

  for (const face of faces) {
    const indexOffset = positions.length / 3;
    for (const corner of face.corners) {
      positions.push(corner[0], corner[1], corner[2]);
      normals.push(face.normal[0], face.normal[1], face.normal[2]);
    }
    uvs.push(part.uv.u0, part.uv.v0, part.uv.u1, part.uv.v0, part.uv.u1, part.uv.v1, part.uv.u0, part.uv.v1);
    indices.push(indexOffset, indexOffset + 1, indexOffset + 2, indexOffset, indexOffset + 2, indexOffset + 3);
  }
}

function box(center: [number, number, number], size: [number, number, number], uv: AtlasRect): BoxPart {
  return { center, size, uv };
}

function rect(u0: number, v0: number, u1: number, v1: number): AtlasRect {
  return { u0, v0, u1, v1 };
}
