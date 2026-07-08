import * as THREE from "three";
import { FLOOR_VARIANTS, type FloorVariantId } from "./floorVariants";
import type { LevelRenderMaterials } from "./levelRenderer";

export type GameplayMaterials = {
  enemy: THREE.MeshStandardMaterial;
  projectile: THREE.MeshBasicMaterial;
  nova: THREE.ShaderMaterial;
  impactPulse: THREE.ShaderMaterial;
  gate: THREE.MeshStandardMaterial;
};

export type SceneMaterials = {
  level: LevelRenderMaterials;
  gameplay: GameplayMaterials;
};

type PreloadedFloorTextures = Partial<Record<FloorVariantId, THREE.Texture>>;

export async function preloadSceneTextures(
  loader: THREE.TextureLoader,
  anisotropy: number,
): Promise<PreloadedFloorTextures> {
  const entries = await Promise.all(
    FLOOR_VARIANTS.map(async (variant) => {
      const texture = await loader.loadAsync(variant.mapUrl);
      configureRepeatingTexture(texture, anisotropy, true);
      return [variant.id, texture] as const;
    }),
  );
  return Object.fromEntries(entries) as PreloadedFloorTextures;
}

export function createSceneMaterials(
  loader: THREE.TextureLoader,
  anisotropy: number,
  preloadedFloorTextures: PreloadedFloorTextures = {},
): SceneMaterials {
  return {
    level: {
      floors: createFloorMaterials(loader, anisotropy, preloadedFloorTextures),
      edge: new THREE.MeshStandardMaterial({ color: 0x111b1e, roughness: 0.86, metalness: 0.32 }),
      void: new THREE.MeshBasicMaterial({ color: 0x010304 }),
      rim: new THREE.MeshBasicMaterial({ color: 0x2ddbd2, transparent: true, opacity: 0.36 }),
    },
    gameplay: {
      enemy: new THREE.MeshStandardMaterial({
        color: 0x8cff55,
        emissive: 0x143b08,
        emissiveIntensity: 1.35,
        roughness: 0.48,
        metalness: 0.25,
      }),
      projectile: new THREE.MeshBasicMaterial({ color: 0x9bf0df }),
      nova: createPulseMaterial(0x4fe7ff, 0xa8fff0, 0x2f9eff, 1.04),
      impactPulse: createImpactBurstMaterial(),
      gate: new THREE.MeshStandardMaterial({
        color: 0x9bf0df,
        emissive: 0x0f5f58,
        emissiveIntensity: 1.75,
        roughness: 0.2,
        metalness: 0.55,
      }),
    },
  };
}

function createPulseMaterial(
  innerColor: THREE.ColorRepresentation,
  rimColor: THREE.ColorRepresentation,
  shockColor: THREE.ColorRepresentation,
  baseOpacity: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uInnerColor: { value: new THREE.Color(innerColor) },
      uRimColor: { value: new THREE.Color(rimColor) },
      uShockColor: { value: new THREE.Color(shockColor) },
      uBaseOpacity: { value: baseOpacity },
      uBloomIntensity: { value: 1.85 },
    },
    vertexShader: `
      attribute vec4 effectData;

      varying vec2 vUv;
      varying vec3 vLocalPosition;
      varying float vProgress;
      varying float vAlpha;
      varying float vSeed;
      varying float vVariant;

      void main() {
        vUv = uv;
        vLocalPosition = position;
        vProgress = effectData.x;
        vAlpha = effectData.y;
        vSeed = effectData.z;
        vVariant = effectData.w;

        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uInnerColor;
      uniform vec3 uRimColor;
      uniform vec3 uShockColor;
      uniform float uBaseOpacity;
      uniform float uBloomIntensity;

      varying vec2 vUv;
      varying vec3 vLocalPosition;
      varying float vProgress;
      varying float vAlpha;
      varying float vSeed;
      varying float vVariant;

      float saturate(float value) {
        return clamp(value, 0.0, 1.0);
      }

      float hash(float value) {
        return fract(sin(value) * 43758.5453123);
      }

      void main() {
        float angle = atan(vLocalPosition.z, vLocalPosition.x);
        float height = vUv.y;
        float vertical = 1.0 - abs(height * 2.0 - 1.0);
        float noiseA = sin(angle * 10.0 + vSeed * 4.7 + vProgress * 8.0);
        float noiseB = sin(angle * 21.0 - vSeed * 2.8 + vProgress * 13.0);
        float noiseC = hash(floor((angle + 3.14159) * 6.0) + vSeed * 19.0);
        float rough = 0.88 + noiseA * 0.12 + noiseB * 0.06 + (noiseC - 0.5) * 0.14;

        float waist = exp(-pow((height - 0.48 - noiseA * 0.018) / 0.18, 2.0));
        float upperEdge = exp(-pow((height - 0.82 - noiseB * 0.012) / 0.034, 2.0));
        float lowerEdge = exp(-pow((height - 0.15 + noiseB * 0.012) / 0.04, 2.0));
        float scanLine = pow(max(0.0, sin(height * 34.0 + angle * 2.0 - vProgress * 16.0 + vSeed)), 5.0);
        float breakup = smoothstep(0.08, 0.42, vertical) * (0.72 + rough * 0.28);

        float leadingGlow = mix(0.96, 0.62, vProgress) * waist;
        float edgeGlow = (upperEdge + lowerEdge) * mix(0.54, 0.28, vProgress);
        float alpha = (leadingGlow + edgeGlow + scanLine * 0.16) * breakup * vAlpha * uBaseOpacity;
        if (alpha < 0.01) discard;

        vec3 color = uShockColor * leadingGlow + uInnerColor * (waist * 0.44 + scanLine * 0.2) + uRimColor * edgeGlow * (0.82 + vVariant * 0.16);
        color *= uBloomIntensity;
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

function createImpactBurstMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uCoreColor: { value: new THREE.Color(0xdffcff) },
      uSparkColor: { value: new THREE.Color(0x8df6ee) },
      uHotColor: { value: new THREE.Color(0xffffff) },
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
      uniform vec3 uSparkColor;
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
        float sector = floor((angle + 3.14159) * 7.0 + vSeed);
        float brokenMask = step(0.28, hash(sector + vSeed * 13.0));
        float rough = 0.82 + sin(angle * 13.0 + vSeed * 2.4) * 0.16 + sin(angle * 23.0 - vSeed) * 0.08;

        float pop = smoothstep(0.44, 0.0, radius) * (1.0 - vProgress) * 0.9;
        float ringCenter = mix(0.34, 0.58, vProgress);
        float ring = exp(-pow((radius - ringCenter) / 0.08, 2.0)) * rough * brokenMask;
        float spokes = pow(max(0.0, sin(angle * 10.0 + vSeed * 4.0)), 10.0);
        spokes *= exp(-pow((radius - mix(0.22, 0.72, vProgress)) / 0.18, 2.0));
        spokes *= 1.0 - smoothstep(0.78, 1.0, radius);

        float alpha = (pop * 1.15 + ring * 1.35 + spokes * 0.68) * vAlpha;
        if (alpha < 0.01) discard;

        vec3 color = uCoreColor * pop + uSparkColor * (ring + spokes * 0.75) + uHotColor * ring * 0.45;
        gl_FragColor = vec4(color, saturate(alpha));
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

function createFloorMaterials(
  loader: THREE.TextureLoader,
  anisotropy: number,
  preloadedFloorTextures: PreloadedFloorTextures,
): Record<FloorVariantId, THREE.MeshStandardMaterial> {
  return Object.fromEntries(
    FLOOR_VARIANTS.map((variant) => {
      const map = preloadedFloorTextures[variant.id] ?? loadRepeatingTexture(loader, variant.mapUrl, anisotropy, true);

      return [
        variant.id,
        new THREE.MeshStandardMaterial({
          map,
          roughness: variant.roughness,
          metalness: variant.metalness,
        }),
      ];
    }),
  ) as Record<FloorVariantId, THREE.MeshStandardMaterial>;
}

function loadRepeatingTexture(
  loader: THREE.TextureLoader,
  url: string,
  anisotropy: number,
  useSrgbColorSpace: boolean,
): THREE.Texture {
  const texture = loader.load(url);
  configureRepeatingTexture(texture, anisotropy, useSrgbColorSpace);
  return texture;
}

function configureRepeatingTexture(
  texture: THREE.Texture,
  anisotropy: number,
  useSrgbColorSpace: boolean,
): void {
  if (useSrgbColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 1);
  texture.anisotropy = anisotropy;
}
