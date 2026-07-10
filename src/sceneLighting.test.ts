import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { addGameplayLighting } from "./sceneLighting";

describe("addGameplayLighting", () => {
  it("casts flashlight shadows from walls close to the player", () => {
    const scene = new THREE.Scene();
    const playerLightAnchor = new THREE.Group();

    addGameplayLighting(scene, playerLightAnchor);

    const flashlight = playerLightAnchor.children.find(
      (child): child is THREE.SpotLight => child instanceof THREE.SpotLight,
    );
    expect(flashlight).toBeDefined();
    expect(flashlight?.castShadow).toBe(true);
    expect(flashlight?.shadow.camera.near).toBeLessThan(0.2);
    expect(flashlight?.shadow.bias).toBe(-0.00005);
    expect(flashlight?.shadow.normalBias).toBe(0.001);
  });
});
