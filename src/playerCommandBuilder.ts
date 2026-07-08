import * as THREE from "three";
import { TILE_SIZE } from "./constants";
import { InputState } from "./inputState";
import { movementInputFor } from "./movement";
import type { PlayerCommand } from "./playerCommand";

export type PlayerCommandContext = {
  canAct: boolean;
  playerPosition: THREE.Vector3;
  playerRotationY: number;
};

export class PlayerCommandBuilder {
  private readonly command: PlayerCommand = {
    movement: new THREE.Vector3(),
    aimWorld: new THREE.Vector3(),
    firePrimary: false,
    fireNova: false,
    dash: false,
  };

  constructor(
    private readonly input: InputState,
    private readonly getCamera: () => THREE.Camera,
  ) {}

  build(context: PlayerCommandContext): PlayerCommand {
    const command = this.command;
    if (!context.canAct) {
      command.movement.set(0, 0, 0);
      command.aimWorld.set(context.playerPosition.x, context.playerPosition.y, context.playerPosition.z - TILE_SIZE);
      command.firePrimary = false;
      command.fireNova = false;
      command.dash = false;
      return command;
    }

    const strafe = (this.input.hasKey("KeyD") ? 1 : 0) - (this.input.hasKey("KeyA") ? 1 : 0);
    const forward = (this.input.hasKey("KeyW") ? 1 : 0) - (this.input.hasKey("KeyS") ? 1 : 0);
    movementInputFor({
      camera: this.getCamera(),
      strafe,
      forward,
      target: command.movement,
    });
    command.aimWorld.copy(this.input.pointerWorld);
    command.firePrimary = this.input.consumePrimaryFire();
    command.fireNova = this.input.consumeNovaFire();
    command.dash = this.input.consumeDash();
    return command;
  }
}
