import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { EventQueue } from "./eventQueue";

describe("EventQueue", () => {
  it("drains emitted events in order and clears the queue", () => {
    const queue = new EventQueue();
    const position = new THREE.Vector3(1, 0, 2);

    queue.emit({ type: "enemyDamaged", enemyId: 1, amount: 12, position });
    queue.emit({ type: "pickupCollected", kind: "ammo", amount: 3 });

    expect(queue.drain()).toEqual([
      { type: "enemyDamaged", enemyId: 1, amount: 12, position },
      { type: "pickupCollected", kind: "ammo", amount: 3 },
    ]);
    expect(queue.drain()).toEqual([]);
  });

  it("can discard queued events", () => {
    const queue = new EventQueue();
    queue.emit({ type: "playerDamaged", amount: 9 });

    queue.clear();

    expect(queue.drain()).toEqual([]);
  });
});
