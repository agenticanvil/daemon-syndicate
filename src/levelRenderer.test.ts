import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { FLOOR_VARIANTS } from "./floorVariants";
import { renderLevel, type LevelRenderMaterials } from "./levelRenderer";
import type { LevelData } from "./level";

describe("renderLevel", () => {
  it("disposes renderer-owned geometry and local materials before rerendering a level", () => {
    const root = new THREE.Group();
    const materials = createMaterials();
    const sharedMaterialDispose = vi.spyOn(materials.void, "dispose");

    renderLevel(root, createTestLevel(), materials);

    const previousGeometries = collectGeometries(root);
    const previousLocalMaterials = collectLocalMaterials(root);
    const geometryDisposeSpies = previousGeometries.map((geometry) => vi.spyOn(geometry, "dispose"));
    const materialDisposeSpies = previousLocalMaterials.map((material) => vi.spyOn(material, "dispose"));

    renderLevel(root, createTestLevel(), materials);

    expect(geometryDisposeSpies.length).toBeGreaterThan(0);
    expect(materialDisposeSpies.length).toBeGreaterThan(0);
    for (const spy of geometryDisposeSpies) expect(spy).toHaveBeenCalledOnce();
    for (const spy of materialDisposeSpies) expect(spy).toHaveBeenCalledOnce();
    expect(sharedMaterialDispose).not.toHaveBeenCalled();
  });
});

function createMaterials(): LevelRenderMaterials {
  return {
    floors: Object.fromEntries(
      FLOOR_VARIANTS.map((variant) => [variant.id, new THREE.MeshStandardMaterial()]),
    ) as LevelRenderMaterials["floors"],
    floorDecal: new THREE.MeshBasicMaterial(),
    edge: new THREE.MeshStandardMaterial(),
    void: new THREE.MeshBasicMaterial(),
    rim: new THREE.MeshBasicMaterial(),
  };
}

function createTestLevel(): LevelData {
  const walkable = new Set(["0,0", "1,0", "0,1", "1,1"]);
  return {
    mapDepth: 1,
    width: 2,
    height: 2,
    exitDirection: "north",
    start: { x: 0, y: 0 },
    end: { x: 1, y: 1 },
    walkable,
    floorVariants: new Map([...walkable].map((tileKey) => [tileKey, FLOOR_VARIANTS[0].id])),
    blocked: new Set(),
    environmentalObjects: [],
    spawnPoints: [],
  };
}

function collectGeometries(root: THREE.Object3D): THREE.BufferGeometry[] {
  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) geometries.add(object.geometry);
  });
  return [...geometries];
}

function collectLocalMaterials(root: THREE.Object3D): THREE.Material[] {
  const sharedMaterials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshBasicMaterial && material.color.getHex() === 0x65d7ff) {
        sharedMaterials.add(material);
      }
      if (material instanceof THREE.ShaderMaterial && "uFadeWidth" in material.uniforms) {
        sharedMaterials.add(material);
      }
      if (material instanceof THREE.MeshBasicMaterial && material.color.getHex() === 0x000000) {
        sharedMaterials.add(material);
      }
    }
  });
  return [...sharedMaterials];
}
