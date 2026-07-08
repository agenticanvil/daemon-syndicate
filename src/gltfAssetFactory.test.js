import { readFile } from "node:fs/promises";
import { join } from "node:path";
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createAssetFactory } from "./assetFactory";
import { attachWeaponToSocket, runtimeGltfAssetDescriptors } from "./gltfAssetFactory";

describe("runtime GLB asset library", () => {
  it("defines player, enemy, pickup, environment, and equipment assets as live GLB URLs", () => {
    const descriptors = runtimeGltfAssetDescriptors();

    expect(assetKeys(descriptors)).toEqual([
      "player/player",
      "enemies/lean-hunter",
      "enemies/venom-spitter",
      "enemies/elite-enemy",
      "enemies/brute",
      "environment/industrial-crate",
      "environment/bio-vat",
      "environment/exit-portal",
      "pickups/health-pickup",
      "pickups/ammo-pickup",
      "pickups/energy-pickup",
      "equipment/bolt-rifle",
    ]);
    expect(new Set(descriptors.map((asset) => asset.category))).toEqual(new Set(["player", "enemies", "pickups", "environment", "equipment"]));

    for (const asset of descriptors) {
      expect(asset.modelUrl).toBe(`/assets/${asset.category}/${asset.name}/${asset.name}.glb`);
      expect(asset.sidecarUrl).toBe(`/assets/${asset.category}/${asset.name}/${asset.name}.asset.json`);
      expect(asset.modelUrl).not.toContain("atlas");
      expect(asset.modelUrl).not.toMatch(/\.png$/);
    }
  });

  it("uses only idle and walk animations for the runtime player asset", async () => {
    const playerAsset = runtimeGltfAssetDescriptors().find((asset) => asset.category === "player");
    expect(playerAsset).toMatchObject({ category: "player", name: "player" });

    const gltfJson = await readGlbJson(join(process.cwd(), "public", playerAsset.modelUrl.replace(/^\//, "")));

    expect(new Set((gltfJson.animations ?? []).map((animation) => animation.name))).toEqual(new Set(["idle", "walk"]));
  });

  it("defines player and weapon socket nodes in the runtime GLBs", async () => {
    const playerGltfJson = await readGlbJson(join(process.cwd(), "public/assets/player/player/player.glb"));
    const rifleGltfJson = await readGlbJson(join(process.cwd(), "public/assets/equipment/bolt-rifle/bolt-rifle.glb"));

    expect(findNode(playerGltfJson, "socket.weapon.primary")).toMatchObject({
      extras: { assetAnvil: { socket: true, id: "weapon.primary" } },
    });
    expect(findNode(rifleGltfJson, "socket.grip")).toMatchObject({
      extras: { assetAnvil: { socket: true, id: "grip" } },
    });
  });

  it("aligns a weapon grip socket to the player weapon socket idempotently", () => {
    const playerRoot = new THREE.Group();
    playerRoot.position.set(3, 0, -2);
    playerRoot.rotation.y = 0.35;
    const playerSocket = new THREE.Object3D();
    playerSocket.name = "socket.weapon.primary";
    playerSocket.position.set(0.4, 1.2, -0.2);
    playerSocket.rotation.set(0.1, -0.2, 0.3);
    playerRoot.add(playerSocket);

    const weaponRoot = createTestWeaponRoot();

    attachWeaponToSocket({ playerRoot, weaponRoot });
    playerRoot.updateWorldMatrix(true, true);

    expect(weaponRoot.parent).toBe(playerSocket);
    expectWorldMatricesToMatch(weaponRoot.getObjectByName("socket.grip").matrixWorld, playerSocket.matrixWorld);

    attachWeaponToSocket({ playerRoot, weaponRoot });

    expect(playerSocket.children.filter((child) => child === weaponRoot)).toHaveLength(1);

    const nextWeaponRoot = createTestWeaponRoot();
    attachWeaponToSocket({ playerRoot, weaponRoot: nextWeaponRoot });

    expect(weaponRoot.parent).toBeNull();
    expect(nextWeaponRoot.parent).toBe(playerSocket);
    expect(playerSocket.children.filter((child) => child.userData.daemonSyndicateEquippedWeapon)).toHaveLength(1);
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
      createEquipmentAsset: () => ({ root: new THREE.Group() }),
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

function findNode(gltfJson, name) {
  return (gltfJson.nodes ?? []).find((node) => node.name === name);
}

function createTestWeaponRoot() {
  const weaponRoot = new THREE.Group();
  weaponRoot.position.set(-2, 0.5, 1);
  weaponRoot.rotation.set(-0.1, 0.7, 0.2);
  const meshNode = new THREE.Group();
  meshNode.position.set(0.3, -0.4, 0.5);
  meshNode.rotation.set(0.2, 0.1, -0.15);
  weaponRoot.add(meshNode);
  const gripSocket = new THREE.Object3D();
  gripSocket.name = "socket.grip";
  gripSocket.position.set(-0.05, 0.2, 0.35);
  gripSocket.rotation.set(0.05, -0.25, 0.12);
  meshNode.add(gripSocket);
  return weaponRoot;
}

function expectWorldMatricesToMatch(actual, expected) {
  for (let index = 0; index < 16; index += 1) {
    expect(actual.elements[index]).toBeCloseTo(expected.elements[index], 5);
  }
}

async function readGlbJson(path) {
  const glb = await readFile(path);
  expect(glb.toString("utf8", 0, 4)).toBe("glTF");
  const jsonChunkLength = glb.readUInt32LE(12);
  const jsonChunkType = glb.toString("utf8", 16, 20);
  expect(jsonChunkType).toBe("JSON");
  return JSON.parse(glb.toString("utf8", 20, 20 + jsonChunkLength).trim());
}
