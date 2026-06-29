import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createBruteGeometry, getBruteGeometryStats } from "./bruteAsset";

describe("Brute asset geometry", () => {
  it("stays a single closed connected skinned mesh under the triangle budget", () => {
    const geometry = createBruteGeometry();
    const stats = getBruteGeometryStats();

    expect(geometry.index).toBeInstanceOf(THREE.BufferAttribute);
    expect(stats.triangles).toBeLessThanOrEqual(1000);
    expect(stats.connectedComponents).toBe(1);
    expect(stats.boundaryEdges).toBe(0);
    expect(stats.inwardFacingComponents).toBe(0);
    expect(geometry.getAttribute("skinIndex")).toBeInstanceOf(THREE.BufferAttribute);
    expect(geometry.getAttribute("skinWeight")).toBeInstanceOf(THREE.BufferAttribute);
    expect(geometry.getAttribute("color")).toBeUndefined();
    expect(geometry.groups).toHaveLength(0);
    expect(geometry.boundingBox?.min.y).toBeCloseTo(0, 6);
  });
});
