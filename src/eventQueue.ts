import type * as THREE from "three";
import type { DropTable } from "./assetSettings";
import type { EnemyKind } from "./enemyDefinitions";
import type { ResourceKind } from "./types";

export type GameEvent =
  | { type: "enemyDamaged"; enemyId: number; amount: number; position: THREE.Vector3 }
  | { type: "enemyKilled"; enemyId: number; kind: EnemyKind; position: THREE.Vector3; dropTable: DropTable }
  | { type: "playerDamaged"; amount: number }
  | { type: "pickupCollected"; kind: ResourceKind; amount: number };

export class EventQueue {
  private events: GameEvent[] = [];

  emit(event: GameEvent): void {
    this.events.push(event);
  }

  drain(): GameEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  clear(): void {
    this.events = [];
  }
}
