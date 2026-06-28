import * as THREE from "three";

export type PlayerCommand = {
  movement: THREE.Vector3;
  aimWorld: THREE.Vector3;
  firePrimary: boolean;
  fireNova: boolean;
};

export function idlePlayerCommand(position = new THREE.Vector3()): PlayerCommand {
  return {
    movement: new THREE.Vector3(),
    aimWorld: position.clone().add(new THREE.Vector3(0, 0, -1)),
    firePrimary: false,
    fireNova: false,
  };
}
