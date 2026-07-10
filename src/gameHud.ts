import type { GameSimulation } from "./gameSimulation";
import { worldToTile } from "./level";
import type { Ui } from "./ui";

export class HudPresenter {
  constructor(private readonly ui: Ui) {}

  update(simulation: GameSimulation): void {
    this.ui.updateHud({
      resources: simulation.resources,
      maxResources: simulation.maxResources,
      kills: simulation.killCount,
      mapDepth: simulation.currentMapDepth,
      progression: simulation.progressionHudState,
      primaryReady: simulation.primaryReady,
      novaReady: simulation.novaReady,
      dashUnlocked: simulation.dashUnlocked,
      dashReady: simulation.dashReady,
      minimap: {
        level: simulation.level,
        playerTile: worldToTile(simulation.playerPosition),
        playerRotation: simulation.playerRotationY,
        explored: simulation.exploredTiles,
      },
    });
  }
}
