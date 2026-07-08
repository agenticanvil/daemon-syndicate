import type * as THREE from "three";
import type { DropTable } from "./assetSettings";
import type { EnemyKind } from "./enemyDefinitions";
import type { ResourceKind } from "./resourceTypes";

export type GameEvent =
  | { type: "enemyDamaged"; enemyId: number; amount: number; position: THREE.Vector3 }
  | {
      type: "enemyKilled";
      enemyId: number;
      kind: EnemyKind;
      enemyLevel: number;
      xpReward: number;
      position: THREE.Vector3;
      dropTable: DropTable;
    }
  | { type: "playerDamaged"; amount: number }
  | { type: "pickupCollected"; kind: ResourceKind; amount: number };

export class EventQueue {
  private readonly events: GameEvent[] = [];

  emit(event: GameEvent): void {
    this.events.push(event);
  }

  drain(): GameEvent[] {
    const drained = this.events.slice();
    this.events.length = 0;
    return drained;
  }

  drainInto(target: GameEvent[]): void {
    target.length = 0;
    for (const event of this.events) {
      target.push(event);
    }
    this.events.length = 0;
  }

  clear(): void {
    this.events.length = 0;
  }
}
