import * as THREE from "three";
import type { AssetBundledMaterial, AssetSidecar } from "./assetManifest";

type BundledShaderUniform =
  | { type: "time" }
  | { type: "float"; value?: number }
  | { type: "color"; value?: string | number }
  | { type: "vec2"; value?: [number, number] }
  | { type: "vec3"; value?: [number, number, number] };

type BundledShaderDefinition = {
  vertexShader: string;
  fragmentShader: string;
  uniforms?: Record<string, BundledShaderUniform>;
  transparent?: boolean;
  depthWrite?: boolean;
  side?: "front" | "back" | "double";
  blending?: "normal" | "additive" | "subtractive" | "multiply";
};

type TimeUniform = {
  value: number;
};

const BUNDLED_SHADER_MATERIAL_KEY = "asset-anvil-bundled-shader-material-v1";

export async function applyBundledShaderMaterials(root: THREE.Object3D, sidecar: AssetSidecar, assetBaseUrl: string): Promise<void> {
  if (!sidecar.materials?.length) return;

  await Promise.all(
    sidecar.materials.map(async (material) => {
      if (material.type !== "shader") return;
      const mesh = root.getObjectByName(material.mesh);
      if (!(mesh instanceof THREE.Mesh)) {
        console.warn(`Missing bundled shader target mesh "${material.mesh}" for asset "${sidecar.id}"`);
        return;
      }
      const shaderMaterial = await loadBundledShaderMaterial(assetBaseUrl, material);
      applyShaderMaterial(mesh, shaderMaterial);
    }),
  );
}

export function applyBundledMaterialConventions(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    if (object.userData[BUNDLED_SHADER_MATERIAL_KEY]) {
      object.castShadow = false;
      object.receiveShadow = false;
    }
  });
}

async function loadBundledShaderMaterial(assetBaseUrl: string, material: AssetBundledMaterial): Promise<THREE.ShaderMaterial> {
  const definitionUrl = resolveAssetUrl(assetBaseUrl, material.definition);
  const response = await fetch(definitionUrl);
  if (!response.ok) throw new Error(`Missing bundled shader definition: ${definitionUrl}`);
  const definition = (await response.json()) as BundledShaderDefinition;
  const shaderBaseUrl = parentUrl(definitionUrl);
  const [vertexShader, fragmentShader] = await Promise.all([
    loadShaderSource(shaderBaseUrl, definition.vertexShader),
    loadShaderSource(shaderBaseUrl, definition.fragmentShader),
  ]);
  const { uniforms, timeUniforms } = createShaderUniforms(definition.uniforms ?? {});

  const shaderMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: definition.transparent ?? false,
    depthWrite: definition.depthWrite ?? true,
    side: sideForDefinition(definition.side),
    blending: blendingForDefinition(definition.blending),
  });
  shaderMaterial.userData.timeUniforms = timeUniforms;
  shaderMaterial.onBeforeRender = () => {
    const time = performance.now() * 0.001;
    for (const uniform of timeUniforms) uniform.value = time;
  };
  return shaderMaterial;
}

async function loadShaderSource(shaderBaseUrl: string, shaderFile: string): Promise<string> {
  const shaderUrl = resolveAssetUrl(shaderBaseUrl, shaderFile);
  const response = await fetch(shaderUrl);
  if (!response.ok) throw new Error(`Missing bundled shader source: ${shaderUrl}`);
  return response.text();
}

function createShaderUniforms(definitions: Record<string, BundledShaderUniform>): {
  uniforms: Record<string, THREE.IUniform>;
  timeUniforms: TimeUniform[];
} {
  const uniforms: Record<string, THREE.IUniform> = {};
  const timeUniforms: TimeUniform[] = [];

  for (const [name, definition] of Object.entries(definitions)) {
    if (definition.type === "time") {
      const uniform = { value: 0 };
      uniforms[name] = uniform;
      timeUniforms.push(uniform);
    } else if (definition.type === "float") {
      uniforms[name] = { value: definition.value ?? 0 };
    } else if (definition.type === "color") {
      uniforms[name] = { value: new THREE.Color(definition.value ?? 0xffffff) };
    } else if (definition.type === "vec2") {
      const value = definition.value ?? [0, 0];
      uniforms[name] = { value: new THREE.Vector2(value[0], value[1]) };
    } else if (definition.type === "vec3") {
      const value = definition.value ?? [0, 0, 0];
      uniforms[name] = { value: new THREE.Vector3(value[0], value[1], value[2]) };
    }
  }

  return { uniforms, timeUniforms };
}

function applyShaderMaterial(mesh: THREE.Mesh, material: THREE.ShaderMaterial): void {
  const previousMaterial = mesh.material;
  mesh.material = material;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData[BUNDLED_SHADER_MATERIAL_KEY] = true;
  disposeMaterial(previousMaterial);
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose());
    return;
  }
  material.dispose();
}

function resolveAssetUrl(baseUrl: string, file: string): string {
  return new URL(file, absoluteAssetBaseUrl(baseUrl)).pathname;
}

function absoluteAssetBaseUrl(baseUrl: string): string {
  return new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`, window.location.origin).href;
}

function parentUrl(url: string): string {
  return url.slice(0, url.lastIndexOf("/") + 1);
}

function sideForDefinition(side: BundledShaderDefinition["side"]): THREE.Side {
  if (side === "front") return THREE.FrontSide;
  if (side === "back") return THREE.BackSide;
  return THREE.DoubleSide;
}

function blendingForDefinition(blending: BundledShaderDefinition["blending"]): THREE.Blending {
  if (blending === "additive") return THREE.AdditiveBlending;
  if (blending === "subtractive") return THREE.SubtractiveBlending;
  if (blending === "multiply") return THREE.MultiplyBlending;
  return THREE.NormalBlending;
}
