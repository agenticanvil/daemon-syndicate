import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createAssetFactory } from "./assetFactory";
import { runtimeGltfAssetDescriptors } from "./gltfAssetFactory";

describe("runtime GLB asset library", () => {
  it("defines player, enemy, pickup, and environment assets as live GLB URLs", () => {
    const descriptors = runtimeGltfAssetDescriptors();

    expect(assetKeys(descriptors)).toEqual([
      "player/player",
      "enemies/lean-hunter",
      "enemies/venom-spitter",
      "enemies/elite-enemy",
      "enemies/brute",
      "environment/industrial-crate",
      "environment/exit-portal",
      "pickups/health-pickup",
      "pickups/ammo-pickup",
      "pickups/energy-pickup",
    ]);
    expect(new Set(descriptors.map((asset) => asset.category))).toEqual(new Set(["player", "enemies", "pickups", "environment"]));

    for (const asset of descriptors) {
      expect(asset.modelUrl).toBe(`/assets/${asset.category}/${asset.name}/${asset.name}.glb`);
      expect(asset.sidecarUrl).toBe(`/assets/${asset.category}/${asset.name}/${asset.name}.asset.json`);
      expect(asset.modelUrl).not.toContain("atlas");
      expect(asset.modelUrl).not.toMatch(/\.png$/);
    }
  });

  it("keeps the game asset factory on the GLB library path", () => {
    expect(() => createAssetFactory(new THREE.TextureLoader(), 1)).toThrow("GLB asset library is required");

    const playerRoot = new THREE.Group();
    const playerBody = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    playerRoot.add(playerBody);
    const enemyRoot = new THREE.Group();
    const pickupRoot = new THREE.Group();
    const environmentRoot = new THREE.Group();
    const portalRoot = new THREE.Group();
    const factory = createAssetFactory(new THREE.TextureLoader(), 1, {
      createPlayerRig: () => ({
        root: playerRoot,
        body: playerBody,
        handSocket: new THREE.Group(),
        setWeapon: () => undefined,
        triggerFire: () => undefined,
        applyBasePose: () => undefined,
        update: () => undefined,
      }),
      createEnemyAsset: () => ({
        root: enemyRoot,
        applyBasePose: () => undefined,
        update: () => undefined,
      }),
      createPickupAsset: () => ({ root: pickupRoot }),
      createEnvironmentAsset: () => ({ root: environmentRoot }),
      createExitPortalAsset: () => ({ root: portalRoot }),
    });

    expect(factory.createPlayerRig().root).toBe(playerRoot);
    expect(factory.createEnemyAsset("leanHunter").root).toBe(enemyRoot);
    expect(factory.createPickupAsset("health").root).toBe(pickupRoot);
    expect(factory.createEnvironmentAsset("industrial-crate").root).toBe(environmentRoot);
    expect(factory.createExitPortalAsset().root).toBe(portalRoot);
  });

  it("pairs every runtime sidecar with a GLB that has no external image URIs", async () => {
    let embeddedImageCount = 0;
    for (const asset of runtimeGltfAssetDescriptors()) {
      const sidecar = JSON.parse(await readFile(join(process.cwd(), "public", asset.sidecarUrl.replace(/^\//, "")), "utf8"));
      expect(sidecar.model?.file).toBe(`${asset.name}.glb`);

      const gltfJson = await readGlbJson(join(process.cwd(), "public", asset.modelUrl.replace(/^\//, "")));
      for (const image of gltfJson.images ?? []) {
        expect(image.uri, asset.modelUrl).toBeUndefined();
        expect(typeof image.bufferView, asset.modelUrl).toBe("number");
        embeddedImageCount += 1;
      }
    }
    expect(embeddedImageCount).toBeGreaterThan(0);
  });
});

function assetKeys(descriptors) {
  return descriptors.map((asset) => `${asset.category}/${asset.name}`);
}

async function readGlbJson(path) {
  const glb = await readFile(path);
  expect(glb.toString("utf8", 0, 4)).toBe("glTF");
  const jsonChunkLength = glb.readUInt32LE(12);
  const jsonChunkType = glb.toString("utf8", 16, 20);
  expect(jsonChunkType).toBe("JSON");
  return JSON.parse(glb.toString("utf8", 20, 20 + jsonChunkLength).trim());
}
