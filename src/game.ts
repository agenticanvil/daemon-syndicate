import * as THREE from "three";
import { ELITE_ENEMY_SETTINGS } from "./assets/enemies/eliteEnemy/eliteEnemyAsset";
import { LEAN_HUNTER_SETTINGS } from "./assets/enemies/leanHunterAsset";
import { AMMO_PICKUP_SETTINGS } from "./assets/pickups/ammoPickup/ammoPickupAsset";
import { ENERGY_PICKUP_SETTINGS } from "./assets/pickups/energyPickup/energyPickupAsset";
import { HEALTH_PICKUP_SETTINGS } from "./assets/pickups/healthPickup/healthPickupAsset";
import { distance2D, overlaps2D, withinRadius2D, type CollisionBody2D, type CollisionLayer } from "./collision";
import {
  AMMO_DROP_AMOUNT,
  ENERGY_DROP_AMOUNT,
  ENERGY_REGEN_PER_SECOND,
  HEALTH_DROP_AMOUNT,
  LEVEL_HEIGHT,
  LEVEL_WIDTH,
  NOVA_COOLDOWN,
  PLAYER_MAX,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PRIMARY_COOLDOWN,
  TILE_SIZE,
} from "./constants";
import {
  exitGateToWorld,
  fromKey,
  generateLevel,
  isWalkable,
  key,
  neighbors,
  tileToWorld,
  worldToTile,
  type LevelData,
  type TileCoord,
} from "./level";
import type { PerfRecorder } from "./perf";
import type { GameScene } from "./scene";
import type { Ui } from "./ui";
import type { DamageText, Enemy, Pickup, PlayerResources, Projectile, ResourceKind } from "./types";

const PLAYER_MODEL_FORWARD_OFFSET = Math.PI;
const MOVEMENT_EPSILON = 0.0001;
const ENEMY_ATTACK_PROXIMITY = 0.42;
const ENEMY_STOP_PROXIMITY = 0.18;
const ENEMY_DEATH_DURATION = 0.5;
const MIN_ENEMY_SPAWN_DISTANCE = TILE_SIZE * 5;
const ENEMY_PATHFINDING_RADIUS = TILE_SIZE * 13;
const ENEMY_DIRECT_APPROACH_RADIUS = TILE_SIZE * 3;
const ENEMY_PATH_REFRESH_INTERVAL = 0.24;
const ENEMY_WAYPOINT_REACHED_DISTANCE = 0.35;

export class Game {
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly pointerWorld = new THREE.Vector3(0, 0, -1);
  private readonly keys = new Set<string>();
  private readonly enemies: Enemy[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly pickups: Pickup[] = [];
  private readonly damageTexts: DamageText[] = [];
  private readonly novaMeshes: THREE.Mesh[] = [];
  private readonly maxResources: PlayerResources = { ...PLAYER_MAX };
  private readonly movementInput = new THREE.Vector3();
  private readonly screenRight = new THREE.Vector3();
  private readonly screenUp = new THREE.Vector3();
  private readonly aimForward = new THREE.Vector3();
  private readonly aimRight = new THREE.Vector3();
  private readonly playerCollisionBody: CollisionBody2D;

  private resources: PlayerResources = { ...PLAYER_MAX };
  private started = false;
  private paused = false;
  private gameOver = false;
  private kills = 0;
  private wave = 1;
  private primaryTimer = 0;
  private novaTimer = 0;
  private invulnTimer = 0;
  private hasPointerPosition = false;
  private playerMoving = false;
  private levelNumber = 1;
  private currentLevel: LevelData;

  constructor(
    private readonly world: GameScene,
    private readonly ui: Ui,
    private readonly perf: PerfRecorder,
  ) {
    this.playerCollisionBody = {
      position: this.world.player.position,
      radius: PLAYER_RADIUS,
      collisionLayer: 0,
    };
    this.currentLevel = generateLevel(this.levelNumber);
    this.world.renderLevel(this.currentLevel);
    this.world.player.position.copy(tileToWorld(this.currentLevel.start));
    this.updatePlayerCollisionLayer();
    this.resetReticle();
  }

  bindEvents(): void {
    window.addEventListener("resize", this.world.resize);
    window.addEventListener("pointermove", this.updatePointerWorld);
    window.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("contextmenu", (event) => event.preventDefault());
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", (event) => this.keys.delete(event.code));
    this.ui.startButton.addEventListener("click", () => this.startNewRun());
    this.ui.resumeButton.addEventListener("click", () => this.setPaused(false));
  }

  startLoop(): void {
    this.animate();
  }

  startNewRun(): void {
    this.reset();
  }

  private readonly updatePointerWorld = (event: PointerEvent): void => {
    this.hasPointerPosition = true;
    this.pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
    this.updatePointerWorldFromCamera();
  };

  private updatePointerWorldFromCamera(): void {
    if (!this.hasPointerPosition) return;

    this.raycaster.setFromCamera(this.pointer, this.world.camera);
    const hit = this.raycaster.intersectObject(this.world.floor, false)[0];
    if (hit) {
      this.pointerWorld.copy(hit.point);
      this.pointerWorld.y = 0;
      this.world.reticle.position.copy(this.pointerWorld);
    }
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.updatePointerWorld(event);
    if (!this.canAct()) return;
    if (event.button === 0) this.firePrimary();
    if (event.button === 2) this.fireNova();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "Escape") {
      event.preventDefault();
      if (this.started && !this.gameOver) {
        this.setPaused(!this.paused);
      }
      return;
    }

    this.keys.add(event.code);
    if (event.code === "Space") {
      event.preventDefault();
      if (this.canAct()) this.fireNova();
    }
  };

  private canAct(): boolean {
    return this.started && !this.gameOver && !this.paused;
  }

  private firePrimary(): void {
    if (this.primaryTimer > 0 || this.resources.ammo < 1) return;

    const direction = this.pointerWorld.clone().sub(this.world.player.position);
    direction.y = 0;
    if (direction.lengthSq() < 0.01) return;
    direction.normalize();

    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), this.world.materials.projectile);
    mesh.position.copy(this.world.player.position).addScaledVector(direction, 0.8);
    mesh.position.y = 0.88;
    this.world.scene.add(mesh);

    this.projectiles.push({
      mesh,
      velocity: direction.multiplyScalar(18),
      collisionLayer: this.currentCollisionLayer(),
      life: 1.05,
      damage: 34,
      radius: 0.28,
    });
    this.world.playerRig.triggerFire();
    this.resources.ammo -= 1;
    this.primaryTimer = PRIMARY_COOLDOWN;
  }

  private fireNova(): void {
    if (this.novaTimer > 0 || this.resources.energy < 35) return;

    const radius = 4.25;
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.2, radius, 64), this.world.materials.nova.clone());
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(this.world.player.position);
    mesh.position.y = 0.08;
    this.world.scene.add(mesh);
    this.novaMeshes.push(mesh);

    for (const enemy of this.enemies) {
      if (enemy.deathTimer !== undefined) continue;
      if (withinRadius2D(enemy, this.playerCollisionBody, radius)) {
        this.damageEnemy(enemy, 58, true);
        const push = enemy.mesh.position.clone().sub(this.world.player.position).setY(0).normalize();
        enemy.mesh.position.addScaledVector(push, 1.2);
      }
    }

    this.resources.energy -= 35;
    this.novaTimer = NOVA_COOLDOWN;
  }

  private spawnEnemy(spawn: THREE.Vector3): void {
    const elite = Math.random() < Math.min(0.08 + this.wave * 0.015, 0.26);
    const rig = elite ? undefined : this.world.createLeanHunterRig();
    const mesh = rig?.root ?? this.world.createEliteEnemyAsset().root;
    mesh.position.set(spawn.x, elite ? 0.72 : 0, spawn.z);
    this.world.scene.add(mesh);

    this.enemies.push({
      mesh,
      updateRig: rig ? (animation, dt) => rig.update({ animation }, dt) : undefined,
      collisionLayer: this.currentCollisionLayer(),
      hp: elite ? ELITE_ENEMY_SETTINGS.health + this.wave * 8 : LEAN_HUNTER_SETTINGS.health + this.wave * 5,
      speed: elite ? 2.2 + this.wave * 0.05 : 2.8 + this.wave * 0.07,
      radius: elite ? ELITE_ENEMY_SETTINGS.collision.radius : LEAN_HUNTER_SETTINGS.collision.radius,
      attackTimer: 0,
      pathRefreshTimer: Math.random() * ENEMY_PATH_REFRESH_INTERVAL,
    });
  }

  private spawnLevelEnemies(): void {
    const candidates = this.currentLevel.spawnPoints
      .map(tileToWorld)
      .filter((position) => distance2D(position, this.world.player.position) >= MIN_ENEMY_SPAWN_DISTANCE);
    const targetCount = Math.min(this.levelEnemyCount(), candidates.length);

    for (let i = 0; i < targetCount; i += 1) {
      const index = Math.floor(Math.random() * candidates.length);
      const [spawn] = candidates.splice(index, 1);
      this.spawnEnemy(spawn);
    }
  }

  private levelEnemyCount(): number {
    return Math.min(10 + this.levelNumber * 3, 32);
  }

  private damageEnemy(enemy: Enemy, amount: number, showText: boolean): void {
    if (enemy.deathTimer !== undefined) return;
    enemy.hp -= amount;
    if (showText) {
      this.showDamageText(enemy.mesh.position, Math.round(amount).toString());
    }
  }

  private showDamageText(position: THREE.Vector3, text: string): void {
    const el = document.createElement("div");
    el.textContent = text;
    el.className = "damage-text";
    document.body.appendChild(el);
    this.damageTexts.push({ el, world: position.clone().add(new THREE.Vector3(0, 1.2, 0)), life: 0.55 });
  }

  private applyMovement(dt: number): void {
    const input = this.getMovementInput();

    this.playerMoving = input.lengthSq() > 0;

    if (this.playerMoving) {
      input.normalize();
      this.movePlayer(input, dt);
    }

    this.checkGateTransition();
  }

  private getMovementInput(): THREE.Vector3 {
    const strafe = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
    const forward = (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0);
    const input = this.movementInput.set(0, 0, 0);

    if (strafe === 0 && forward === 0) return input;

    switch (this.ui.getMovementMode()) {
      case "screen":
        return this.getScreenMovementInput(input, strafe, forward);
      case "mouse":
        return this.getMouseMovementInput(input, strafe, forward);
      case "isometric":
      default:
        return this.getIsometricMovementInput(input, strafe, forward);
    }
  }

  private getIsometricMovementInput(input: THREE.Vector3, strafe: number, forward: number): THREE.Vector3 {
    return input.set(strafe, 0, -forward);
  }

  private getScreenMovementInput(input: THREE.Vector3, strafe: number, forward: number): THREE.Vector3 {
    this.world.camera.updateMatrixWorld();
    this.screenRight.setFromMatrixColumn(this.world.camera.matrixWorld, 0).setY(0);
    this.screenUp.setFromMatrixColumn(this.world.camera.matrixWorld, 1).setY(0);

    if (this.screenRight.lengthSq() <= MOVEMENT_EPSILON || this.screenUp.lengthSq() <= MOVEMENT_EPSILON) {
      return this.getIsometricMovementInput(input, strafe, forward);
    }

    this.screenRight.normalize();
    this.screenUp.normalize();
    return input.addScaledVector(this.screenRight, strafe).addScaledVector(this.screenUp, forward);
  }

  private getMouseMovementInput(input: THREE.Vector3, strafe: number, forward: number): THREE.Vector3 {
    this.aimForward.copy(this.pointerWorld).sub(this.world.player.position).setY(0);

    if (this.aimForward.lengthSq() <= MOVEMENT_EPSILON) {
      const aimYaw = this.world.player.rotation.y - PLAYER_MODEL_FORWARD_OFFSET;
      this.aimForward.set(Math.sin(aimYaw), 0, Math.cos(aimYaw));
    }

    this.aimForward.normalize();
    this.aimRight.set(-this.aimForward.z, 0, this.aimForward.x);
    return input.addScaledVector(this.aimRight, strafe).addScaledVector(this.aimForward, forward);
  }

  private updatePlayerAim(): void {
    const aim = this.pointerWorld.clone().sub(this.world.player.position).setY(0);
    if (aim.lengthSq() > 0.01) {
      this.world.player.rotation.y = this.getPlayerAimYaw(aim);
    }
  }

  private getPlayerAimYaw(aim: THREE.Vector3): number {
    return Math.atan2(aim.x, aim.z) + PLAYER_MODEL_FORWARD_OFFSET;
  }

  private updateCamera(): void {
    const offset = new THREE.Vector3(25, 26, 25);
    this.world.camera.position.copy(this.world.player.position).add(offset);
    this.world.camera.lookAt(this.world.player.position);
  }

  private movePlayer(input: THREE.Vector3, dt: number): void {
    const distance = PLAYER_SPEED * dt;
    const current = this.world.player.position.clone();
    const full = current.clone().addScaledVector(input, distance);
    if (isWalkable(this.currentLevel, full)) {
      this.world.player.position.copy(full);
      return;
    }

    const xOnly = current.clone();
    xOnly.x += input.x * distance;
    if (isWalkable(this.currentLevel, xOnly)) {
      this.world.player.position.copy(xOnly);
    }

    const zOnly = this.world.player.position.clone();
    zOnly.z += input.z * distance;
    if (isWalkable(this.currentLevel, zOnly)) {
      this.world.player.position.copy(zOnly);
    }
  }

  private checkGateTransition(): void {
    const end = exitGateToWorld(this.currentLevel.end, this.currentLevel.exitDirection);
    if (distance2D(this.world.player.position, end) < 1.15) {
      this.loadNextLevel();
    }
  }

  private updateEnemies(dt: number): void {
    for (const enemy of this.enemies) {
      if (enemy.hp <= 0 && enemy.deathTimer === undefined) {
        enemy.deathTimer = ENEMY_DEATH_DURATION;
        enemy.updateRig?.("death", 0);
      }

      if (enemy.deathTimer !== undefined) {
        enemy.deathTimer -= dt;
        enemy.updateRig?.("death", dt);
        continue;
      }

      const distance = distance2D(enemy.mesh.position, this.world.player.position);
      const attackDistance = PLAYER_RADIUS + enemy.radius + ENEMY_ATTACK_PROXIMITY;
      const pursuitDirection = this.getEnemyPursuitDirection(enemy, distance, enemy.speed * dt, dt);
      let moved = false;

      if (distance > PLAYER_RADIUS + enemy.radius + ENEMY_STOP_PROXIMITY) {
        moved = this.moveEnemy(enemy, pursuitDirection, enemy.speed * dt);
      }

      if (pursuitDirection.lengthSq() > MOVEMENT_EPSILON) {
        enemy.mesh.rotation.y = this.getEnemyFacingYaw(pursuitDirection);
      } else if (!enemy.updateRig) {
        enemy.mesh.rotation.y += dt * 2.4;
      }

      enemy.attackTimer -= dt;
      const inAttackRange = withinRadius2D(enemy, this.playerCollisionBody, attackDistance);
      if (inAttackRange) {
        enemy.updateRig?.("melee", dt);
      } else {
        enemy.updateRig?.(moved ? "walk" : "idle", dt);
      }

      if (inAttackRange && enemy.attackTimer <= 0 && this.invulnTimer <= 0) {
        this.resources.health = Math.max(0, this.resources.health - 9);
        enemy.attackTimer = 0.72;
        this.invulnTimer = 0.14;
        this.world.playerBody.material.color.set(this.resources.health <= 30 ? 0xff7474 : 0xffffff);
        if (this.resources.health <= 0) {
          this.endGame();
        }
      }
    }

    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i];
      if (enemy.deathTimer !== undefined && enemy.deathTimer <= 0) {
        this.maybeDropPickup(enemy.mesh.position);
        this.world.scene.remove(enemy.mesh);
        this.disposeObject3D(enemy.mesh, Boolean(enemy.updateRig));
        this.enemies.splice(i, 1);
        this.kills += 1;
      }
    }
  }

  private getEnemyPursuitDirection(
    enemy: Enemy,
    playerDistance: number,
    moveDistance: number,
    dt: number,
  ): THREE.Vector3 {
    const direct = this.world.player.position.clone().sub(enemy.mesh.position).setY(0);
    if (direct.lengthSq() <= MOVEMENT_EPSILON) return direct;
    direct.normalize();

    if (playerDistance > ENEMY_PATHFINDING_RADIUS) {
      enemy.path = undefined;
      enemy.pathTarget = undefined;
      return direct;
    }

    if (playerDistance <= ENEMY_DIRECT_APPROACH_RADIUS && this.canEnemyMove(enemy, direct, moveDistance)) {
      enemy.path = undefined;
      enemy.pathTarget = undefined;
      return direct;
    }

    const playerTile = worldToTile(this.world.player.position);
    const playerKey = key(playerTile);
    enemy.pathRefreshTimer = (enemy.pathRefreshTimer ?? 0) - dt;
    if (!enemy.path || enemy.pathTarget !== playerKey || enemy.pathRefreshTimer <= 0) {
      enemy.path = this.findEnemyPath(enemy, playerTile);
      enemy.pathTarget = playerKey;
      enemy.pathRefreshTimer = ENEMY_PATH_REFRESH_INTERVAL + Math.random() * 0.08;
    }

    const pathDirection = this.getEnemyPathDirection(enemy);
    return pathDirection ?? direct;
  }

  private getEnemyPathDirection(enemy: Enemy): THREE.Vector3 | undefined {
    const path = enemy.path;
    if (!path || path.length === 0) return undefined;

    while (path.length > 0) {
      const waypoint = tileToWorld(fromKey(path[0]));
      const offset = waypoint.sub(enemy.mesh.position).setY(0);
      if (offset.length() > ENEMY_WAYPOINT_REACHED_DISTANCE) {
        return offset.normalize();
      }
      path.shift();
    }

    return undefined;
  }

  private moveEnemy(enemy: Enemy, direction: THREE.Vector3, distance: number): boolean {
    if (direction.lengthSq() <= MOVEMENT_EPSILON) return false;

    const current = enemy.mesh.position.clone();
    const full = current.clone().addScaledVector(direction, distance);
    if (isWalkable(this.currentLevel, full)) {
      enemy.mesh.position.copy(full);
      return true;
    }

    let moved = false;
    const xOnly = current.clone();
    xOnly.x += direction.x * distance;
    if (isWalkable(this.currentLevel, xOnly)) {
      enemy.mesh.position.copy(xOnly);
      moved = true;
    }

    const zOnly = enemy.mesh.position.clone();
    zOnly.z += direction.z * distance;
    if (isWalkable(this.currentLevel, zOnly)) {
      enemy.mesh.position.copy(zOnly);
      moved = true;
    }

    return moved;
  }

  private canEnemyMove(enemy: Enemy, direction: THREE.Vector3, distance: number): boolean {
    if (direction.lengthSq() <= MOVEMENT_EPSILON) return false;

    const current = enemy.mesh.position;
    const full = current.clone().addScaledVector(direction, distance);
    if (isWalkable(this.currentLevel, full)) return true;

    const xOnly = current.clone();
    xOnly.x += direction.x * distance;
    if (isWalkable(this.currentLevel, xOnly)) return true;

    const zOnly = current.clone();
    zOnly.z += direction.z * distance;
    return isWalkable(this.currentLevel, zOnly);
  }

  private findEnemyPath(enemy: Enemy, target: TileCoord): string[] | undefined {
    const start = worldToTile(enemy.mesh.position);
    const startKey = key(start);
    const targetKey = key(target);

    if (startKey === targetKey) return [];
    if (!this.currentLevel.walkable.has(startKey) || !this.currentLevel.walkable.has(targetKey)) return undefined;

    const queue: string[] = [startKey];
    const cameFrom = new Map<string, string | undefined>([[startKey, undefined]]);

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const currentKey = queue[cursor];
      if (currentKey === targetKey) break;

      for (const neighbor of neighbors(fromKey(currentKey))) {
        const neighborKey = key(neighbor);
        if (!this.currentLevel.walkable.has(neighborKey) || cameFrom.has(neighborKey)) continue;
        cameFrom.set(neighborKey, currentKey);
        queue.push(neighborKey);
      }
    }

    if (!cameFrom.has(targetKey)) return undefined;

    const path: string[] = [];
    let current: string | undefined = targetKey;
    while (current && current !== startKey) {
      path.push(current);
      current = cameFrom.get(current);
    }
    path.reverse();
    return path;
  }

  private maybeDropPickup(position: THREE.Vector3): void {
    const roll = Math.random();
    if (roll > 0.72) return;
    const kind: ResourceKind = roll < 0.14 ? "health" : roll < 0.48 ? "ammo" : "energy";
    const amount = kind === "health" ? HEALTH_DROP_AMOUNT : kind === "ammo" ? AMMO_DROP_AMOUNT : ENERGY_DROP_AMOUNT;
    const settings =
      kind === "health" ? HEALTH_PICKUP_SETTINGS : kind === "ammo" ? AMMO_PICKUP_SETTINGS : ENERGY_PICKUP_SETTINGS;
    const mesh = this.world.createPickupAsset(kind).root;
    mesh.position.copy(position);
    mesh.position.y = 0.45;
    this.world.scene.add(mesh);
    this.pickups.push({
      mesh,
      kind,
      collisionLayer: this.currentCollisionLayer(),
      amount,
      radius: settings.collision.radius,
      life: 18,
    });
  }

  private updatePickups(dt: number): void {
    for (const pickup of this.pickups) {
      pickup.life -= dt;
      pickup.mesh.rotation.y += dt * 2.6;
      pickup.mesh.position.y = 0.45 + Math.sin(performance.now() * 0.004 + pickup.mesh.id) * 0.08;

      if (overlaps2D(pickup, this.playerCollisionBody)) {
        this.resources[pickup.kind] = Math.min(
          this.maxResources[pickup.kind],
          this.resources[pickup.kind] + pickup.amount,
        );
        pickup.life = 0;
      }
    }

    for (let i = this.pickups.length - 1; i >= 0; i -= 1) {
      const pickup = this.pickups[i];
      if (pickup.life <= 0) {
        this.world.scene.remove(pickup.mesh);
        pickup.mesh.geometry.dispose();
        this.pickups.splice(i, 1);
      }
    }
  }

  private updateProjectiles(dt: number): void {
    for (const projectile of this.projectiles) {
      projectile.mesh.position.addScaledVector(projectile.velocity, dt);
      projectile.life -= dt;

      for (const enemy of this.enemies) {
        if (enemy.deathTimer !== undefined) continue;
        if (overlaps2D(projectile, enemy)) {
          this.damageEnemy(enemy, projectile.damage, true);
          projectile.life = 0;
          break;
        }
      }
    }

    for (let i = this.projectiles.length - 1; i >= 0; i -= 1) {
      const projectile = this.projectiles[i];
      if (
        projectile.life <= 0 ||
        Math.abs(projectile.mesh.position.x) > (LEVEL_WIDTH * TILE_SIZE) / 2 ||
        Math.abs(projectile.mesh.position.z) > (LEVEL_HEIGHT * TILE_SIZE) / 2
      ) {
        this.world.scene.remove(projectile.mesh);
        projectile.mesh.geometry.dispose();
        this.projectiles.splice(i, 1);
      }
    }
  }

  private updateEffects(dt: number): void {
    for (let i = this.novaMeshes.length - 1; i >= 0; i -= 1) {
      const mesh = this.novaMeshes[i];
      mesh.scale.addScalar(dt * 1.4);
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.opacity -= dt * 1.2;
      if (material.opacity <= 0) {
        this.world.scene.remove(mesh);
        mesh.geometry.dispose();
        material.dispose();
        this.novaMeshes.splice(i, 1);
      }
    }

    for (let i = this.damageTexts.length - 1; i >= 0; i -= 1) {
      const damageText = this.damageTexts[i];
      damageText.life -= dt;
      damageText.world.y += dt * 1.1;
      const projected = damageText.world.clone().project(this.world.camera);
      damageText.el.style.transform =
        `translate(${((projected.x + 1) * window.innerWidth) / 2}px, ${((-projected.y + 1) * window.innerHeight) / 2}px)`;
      damageText.el.style.opacity = Math.max(damageText.life / 0.55, 0).toString();
      if (damageText.life <= 0) {
        damageText.el.remove();
        this.damageTexts.splice(i, 1);
      }
    }
  }

  private regenerate(dt: number): void {
    this.resources.energy = Math.min(
      this.maxResources.energy,
      this.resources.energy + ENERGY_REGEN_PER_SECOND * dt,
    );
  }

  private setPaused(paused: boolean): void {
    this.paused = paused;
    this.ui.setPaused(paused);
  }

  private updateHud(): void {
    this.ui.updateHud({
      resources: this.resources,
      maxResources: this.maxResources,
      kills: this.kills,
      level: this.levelNumber,
      primaryReady: this.primaryTimer <= 0 && this.resources.ammo >= 1,
      novaReady: this.novaTimer <= 0 && this.resources.energy >= 35,
    });
  }

  private endGame(): void {
    this.gameOver = true;
    this.setPaused(false);
    this.ui.showGameOver(this.kills);
  }

  private reset(): void {
    this.clearEntities();
    this.levelNumber = 1;
    this.currentLevel = generateLevel(this.levelNumber);
    this.world.renderLevel(this.currentLevel);
    this.world.player.position.copy(tileToWorld(this.currentLevel.start));
    this.updatePlayerCollisionLayer();
    this.resetReticle();
    this.resources = { ...PLAYER_MAX };
    this.kills = 0;
    this.wave = 1;
    this.spawnLevelEnemies();
    this.primaryTimer = 0;
    this.novaTimer = 0;
    this.invulnTimer = 0;
    this.gameOver = false;
    this.paused = false;
    this.world.playerBody.material.color.set(0x9bf0df);
    this.ui.hideOverlay();
    this.ui.setHudVisible(true);
    this.ui.setPaused(false);
    this.started = true;
    this.updateHud();
  }

  private loadNextLevel(): void {
    this.clearEntities();
    this.levelNumber += 1;
    this.wave = this.levelNumber;
    this.currentLevel = generateLevel(this.levelNumber);
    this.world.renderLevel(this.currentLevel);
    this.world.player.position.copy(tileToWorld(this.currentLevel.start));
    this.updatePlayerCollisionLayer();
    this.resetReticle();
    this.spawnLevelEnemies();
    this.primaryTimer = 0;
    this.novaTimer = Math.min(this.novaTimer, 0.4);
    this.updateHud();
  }

  private resetReticle(): void {
    this.pointerWorld.copy(this.world.player.position).add(new THREE.Vector3(0, 0, -TILE_SIZE));
    this.world.reticle.position.copy(this.pointerWorld);
  }

  private clearEntities(): void {
    for (const enemy of this.enemies.splice(0)) {
      this.world.scene.remove(enemy.mesh);
      this.disposeObject3D(enemy.mesh, Boolean(enemy.updateRig));
    }
    for (const projectile of this.projectiles.splice(0)) {
      this.world.scene.remove(projectile.mesh);
      projectile.mesh.geometry.dispose();
    }
    for (const pickup of this.pickups.splice(0)) {
      this.world.scene.remove(pickup.mesh);
      pickup.mesh.geometry.dispose();
    }
    for (const damageText of this.damageTexts.splice(0)) {
      damageText.el.remove();
    }
    for (const mesh of this.novaMeshes.splice(0)) {
      this.world.scene.remove(mesh);
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material) => material.dispose());
      } else {
        mesh.material.dispose();
      }
    }
  }

  private currentCollisionLayer(): CollisionLayer {
    return this.currentLevel.id;
  }

  private updatePlayerCollisionLayer(): void {
    this.playerCollisionBody.collisionLayer = this.currentCollisionLayer();
  }

  private getEnemyFacingYaw(direction: THREE.Vector3): number {
    return Math.atan2(-direction.x, -direction.z);
  }

  private disposeObject3D(object: THREE.Object3D, disposeMaterials: boolean): void {
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      if (!disposeMaterials) return;
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => this.disposeMaterial(material));
      } else {
        this.disposeMaterial(child.material);
      }
    });
  }

  private disposeMaterial(material: THREE.Material): void {
    const textures = new Set<THREE.Texture>();
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) {
        textures.add(value);
      }
    }
    textures.forEach((texture) => texture.dispose());
    material.dispose();
  }

  private perfFrameArgs(dt: number): Record<string, number | string | boolean> {
    return {
      dtMs: Math.round(dt * 100000) / 100,
      started: this.started,
      paused: this.paused,
      gameOver: this.gameOver,
      enemies: this.enemies.length,
      projectiles: this.projectiles.length,
      pickups: this.pickups.length,
      damageTexts: this.damageTexts.length,
      novaMeshes: this.novaMeshes.length,
      level: this.levelNumber,
      wave: this.wave,
      kills: this.kills,
      renderCalls: this.world.renderer.info.render.calls,
      triangles: this.world.renderer.info.render.triangles,
      geometries: this.world.renderer.info.memory.geometries,
      textures: this.world.renderer.info.memory.textures,
    };
  }

  private readonly animate = (): void => {
    requestAnimationFrame(this.animate);
    const dt = Math.min(this.clock.getDelta(), 0.033);

    this.perf.frame(this.perfFrameArgs(dt), () => {
      if (this.started && !this.gameOver && !this.paused) {
        this.perf.span("timers", () => {
          this.primaryTimer = Math.max(this.primaryTimer - dt, 0);
          this.novaTimer = Math.max(this.novaTimer - dt, 0);
          this.invulnTimer = Math.max(this.invulnTimer - dt, 0);
          this.world.playerBody.material.color.lerp(
            new THREE.Color(this.resources.health <= 30 ? 0xff7474 : 0x9bf0df),
            dt * 10,
          );
        });

        this.perf.span("regenerate", () => this.regenerate(dt));
        this.perf.span("movement", () => this.applyMovement(dt));
        this.perf.span("camera", () => this.updateCamera());
        this.perf.span("pointer.world", () => this.updatePointerWorldFromCamera());
        this.perf.span("player.aim", () => this.updatePlayerAim());
        this.perf.span("player.rig", () =>
          this.world.playerRig.update(
            {
              moving: this.playerMoving,
              moveSpeed: PLAYER_SPEED,
              damaged: this.invulnTimer > 0,
              lowHealth: this.resources.health <= 30,
            },
            dt,
          ),
        );
        this.perf.span("projectiles", () => this.updateProjectiles(dt));
        this.perf.span("enemies", () => this.updateEnemies(dt));
        this.perf.span("pickups", () => this.updatePickups(dt));
        this.perf.span("effects/dom", () => this.updateEffects(dt));
        this.perf.span("hud/dom", () => this.updateHud());
      }

      if (!this.started || this.gameOver || this.paused) {
        this.perf.span("camera", () => this.updateCamera());
      }
      this.perf.span("three.render.cpu", () => this.world.renderer.render(this.world.scene, this.world.camera));
    });
  };
}
