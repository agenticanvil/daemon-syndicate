import * as THREE from "three";
import { TILE_SIZE } from "./constants";

const PATCH_KEY = "daemonSyndicatePlayerLocalAmbient";

type Shader = Parameters<THREE.Material["onBeforeCompile"]>[0];

export type PlayerLocalAmbient = {
  update: (playerPosition: THREE.Vector3) => void;
  applyToMaterial: (material: THREE.MeshStandardMaterial, strength?: number) => void;
  applyToObject: (object: THREE.Object3D, strength?: number) => void;
};

export function createPlayerLocalAmbient(): PlayerLocalAmbient {
  const sharedUniforms = {
    uPlayerAmbientPosition: { value: new THREE.Vector3() },
    uPlayerAmbientColor: { value: new THREE.Color(0xbffcff) },
    uPlayerAmbientBrightRadius: { value: TILE_SIZE * 3 },
    uPlayerAmbientFalloffRadius: { value: TILE_SIZE * 5.5 },
  };

  const applyToMaterial = (material: THREE.MeshStandardMaterial, strength = 0.54): void => {
    if (material.userData[PATCH_KEY]) return;
    material.userData[PATCH_KEY] = true;
    const uniforms = {
      ...sharedUniforms,
      uPlayerAmbientStrength: { value: strength },
    };

    const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
    const previousCacheKey = material.customProgramCacheKey.bind(material);

    material.onBeforeCompile = (shader, renderer) => {
      previousOnBeforeCompile(shader, renderer);
      patchShader(shader, uniforms);
    };
    material.customProgramCacheKey = () => `${previousCacheKey()}|player-local-ambient-v1`;
    material.needsUpdate = true;
  };

  return {
    update: (playerPosition) => {
      sharedUniforms.uPlayerAmbientPosition.value.copy(playerPosition);
    },
    applyToMaterial,
    applyToObject: (object, strength = 0.54) => {
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => {
          if (material instanceof THREE.MeshStandardMaterial) applyToMaterial(material, strength);
        });
      });
    },
  };
}

function patchShader(
  shader: Shader,
  uniforms: {
    uPlayerAmbientPosition: { value: THREE.Vector3 };
    uPlayerAmbientColor: { value: THREE.Color };
    uPlayerAmbientBrightRadius: { value: number };
    uPlayerAmbientFalloffRadius: { value: number };
    uPlayerAmbientStrength: { value: number };
  },
): void {
  Object.assign(shader.uniforms, uniforms);

  shader.vertexShader = replaceOnce(
    shader.vertexShader,
    "#include <common>",
    `
    #include <common>
    varying vec3 vPlayerAmbientWorldPosition;
    `,
  );
  shader.vertexShader = replaceOnce(
    shader.vertexShader,
    "#include <worldpos_vertex>",
    `
    #include <worldpos_vertex>
    vPlayerAmbientWorldPosition = worldPosition.xyz;
    `,
  );

  shader.fragmentShader = replaceOnce(
    shader.fragmentShader,
    "#include <common>",
    `
    #include <common>
    uniform vec3 uPlayerAmbientPosition;
    uniform vec3 uPlayerAmbientColor;
    uniform float uPlayerAmbientBrightRadius;
    uniform float uPlayerAmbientFalloffRadius;
    uniform float uPlayerAmbientStrength;
    varying vec3 vPlayerAmbientWorldPosition;
    `,
  );
  shader.fragmentShader = replaceOnce(
    shader.fragmentShader,
    "#include <emissivemap_fragment>",
    `
    #include <emissivemap_fragment>
    float playerAmbientDistance = distance(vPlayerAmbientWorldPosition.xz, uPlayerAmbientPosition.xz);
    float playerAmbientFalloff = 1.0 - smoothstep(
      uPlayerAmbientBrightRadius,
      uPlayerAmbientFalloffRadius,
      playerAmbientDistance
    );
    totalEmissiveRadiance += diffuseColor.rgb * uPlayerAmbientColor * playerAmbientFalloff * uPlayerAmbientStrength;
    `,
  );
}

function replaceOnce(source: string, search: string, replacement: string): string {
  return source.includes(search) ? source.replace(search, replacement) : source;
}
