import { Game } from "./game";
import { createGameScene } from "./scene";
import "./style.css";
import { createUi } from "./ui";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app root");
}

const ui = createUi(app);
const world = createGameScene(app);
const game = new Game(world, ui);

game.bindEvents();
game.startLoop();
