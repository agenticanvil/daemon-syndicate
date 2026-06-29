import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createRigidSkinnedAsset, createStaticMergedAsset } from "./riggedAsset";

describe("rigged asset geometry merging", () => {
  it("does not bake part colors into vertex color attributes", () => {
    const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), color: 0xffffff });
    const skinned = createRigidSkinnedAsset({
      name: "test-rig",
      bones: [{ name: "root" }],
      materials: { surface: material },
      parts: [
        {
          name: "colored-part",
          bone: "root",
          material: "surface",
          geometry: new THREE.BoxGeometry(1, 1, 1),
          color: 0xff0000,
        },
      ],
    });
    const staticMerged = createStaticMergedAsset({
      name: "test-static",
      materials: { surface: material },
      parts: [
        {
          name: "colored-static-part",
          material: "surface",
          geometry: new THREE.BoxGeometry(1, 1, 1),
          color: 0x00ff00,
        },
      ],
    });

    expect(skinned.meshes.surface?.geometry.getAttribute("color")).toBeUndefined();
    expect((staticMerged.children[0] as THREE.Mesh).geometry.getAttribute("color")).toBeUndefined();
  });
});
