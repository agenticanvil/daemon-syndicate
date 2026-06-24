import * as THREE from "three";

const PLAYER_ARMOR_ATLAS_URL = "/assets/player-armor-atlas.png";
const PLAYER_MODEL_FLOOR_OFFSET = 0.54;

export type PlayerAnimationState = {
  moving: boolean;
  moveSpeed: number;
  damaged: boolean;
  lowHealth: boolean;
};

export type PlayerRig = {
  root: THREE.Group;
  body: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  handSocket: THREE.Group;
  setWeapon: (weapon: THREE.Object3D) => void;
  triggerFire: () => void;
  update: (state: PlayerAnimationState, dt: number) => void;
};

type PlayerMaterials = {
  armor: THREE.MeshStandardMaterial;
  softSuit: THREE.MeshStandardMaterial;
  darkMetal: THREE.MeshStandardMaterial;
  tealGlow: THREE.MeshBasicMaterial;
  redGlow: THREE.MeshBasicMaterial;
};

export function loadPlayerRig(loader: THREE.TextureLoader, anisotropy: number): PlayerRig {
  const armorAtlas = loader.load(PLAYER_ARMOR_ATLAS_URL);
  armorAtlas.colorSpace = THREE.SRGBColorSpace;
  armorAtlas.anisotropy = anisotropy;

  return createProceduralPlayerRig(armorAtlas);
}

function createProceduralPlayerRig(armorAtlas: THREE.Texture): PlayerRig {
  const materials = createPlayerMaterials(armorAtlas);
  const root = new THREE.Group();
  root.name = "player-rig";

  const motionRoot = new THREE.Group();
  motionRoot.name = "motion-root";
  root.add(motionRoot);

  const pelvis = mesh("pelvis-armor", new THREE.BoxGeometry(0.56, 0.28, 0.44), materials.armor);
  pelvis.position.y = 0.72;
  motionRoot.add(pelvis);

  const spine = new THREE.Group();
  spine.name = "spine-joint";
  spine.position.y = 0.96;
  motionRoot.add(spine);

  const body = mesh("torso-core", new THREE.BoxGeometry(0.72, 0.78, 0.46), materials.armor);
  body.scale.set(1, 1, 0.82);
  body.position.y = 0.24;
  spine.add(body);

  const chestPlate = mesh("angular-chest-plate", new THREE.BoxGeometry(0.86, 0.34, 0.13), materials.armor);
  chestPlate.position.set(0, 0.44, -0.27);
  spine.add(chestPlate);

  addGlowBar(spine, materials.tealGlow, 0, 0.45, -0.35, 0.24, 0.035);
  addGlowBar(spine, materials.redGlow, -0.25, 0.25, -0.35, 0.06, 0.025);
  addGlowBar(spine, materials.redGlow, 0.25, 0.25, -0.35, 0.06, 0.025);

  const backpack = mesh("power-pack", new THREE.BoxGeometry(0.36, 0.62, 0.22), materials.darkMetal);
  backpack.position.set(0, 0.28, 0.32);
  spine.add(backpack);
  addGlowBar(spine, materials.tealGlow, 0, 0.28, 0.45, 0.08, 0.34);

  const neck = mesh("neck-ring", new THREE.CylinderGeometry(0.19, 0.2, 0.14, 8), materials.darkMetal);
  neck.position.y = 0.72;
  spine.add(neck);

  const head = new THREE.Group();
  head.name = "head-joint";
  head.position.y = 0.92;
  spine.add(head);

  const helmet = mesh("helmet", new THREE.DodecahedronGeometry(0.34, 0), materials.armor);
  helmet.scale.set(0.88, 1.05, 0.78);
  head.add(helmet);

  const visor = mesh("cyan-visor", new THREE.BoxGeometry(0.38, 0.1, 0.035), materials.tealGlow);
  visor.position.set(0, 0.04, -0.27);
  head.add(visor);

  const belt = createBelt(materials);
  belt.position.y = 0.62;
  motionRoot.add(belt);

  const leftLeg = createLeg("left", materials);
  leftLeg.group.position.set(-0.21, 0.62, 0.02);
  motionRoot.add(leftLeg.group);

  const rightLeg = createLeg("right", materials);
  rightLeg.group.position.set(0.21, 0.62, 0.02);
  motionRoot.add(rightLeg.group);

  const leftArm = createArm("left", materials);
  leftArm.upper.position.set(-0.54, 1.56, -0.02);
  motionRoot.add(leftArm.upper);

  const rightArm = createArm("right", materials);
  rightArm.upper.position.set(0.54, 1.56, -0.02);
  motionRoot.add(rightArm.upper);

  const weaponSocket = new THREE.Group();
  weaponSocket.name = "weapon-socket";
  weaponSocket.position.set(0.72, 1.29, -0.28);
  weaponSocket.rotation.y = -0.02;
  motionRoot.add(weaponSocket);

  const rifle = createPulseRifle(materials);
  weaponSocket.add(rifle);

  const parts = [
    pelvis,
    body,
    chestPlate,
    backpack,
    neck,
    helmet,
    visor,
    belt,
    leftLeg.group,
    rightLeg.group,
    leftArm.upper,
    rightArm.upper,
    rifle,
  ];
  parts.forEach((part) => {
    part.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
  });

  let elapsed = 0;
  let walkBlend = 0;
  let recoil = 0;
  let equippedWeapon: THREE.Object3D = rifle;

  return {
    root,
    body,
    handSocket: weaponSocket,
    setWeapon(weapon: THREE.Object3D) {
      weaponSocket.remove(equippedWeapon);
      equippedWeapon = weapon;
      weaponSocket.add(equippedWeapon);
    },
    triggerFire() {
      recoil = 1;
    },
    update(state: PlayerAnimationState, dt: number) {
      elapsed += dt;
      walkBlend = THREE.MathUtils.damp(walkBlend, state.moving ? 1 : 0, 12, dt);
      recoil = THREE.MathUtils.damp(recoil, 0, 18, dt);

      const stride = elapsed * Math.max(state.moveSpeed, 4.8);
      const step = Math.sin(stride * 1.7);
      const counterStep = Math.sin(stride * 1.7 + Math.PI);
      const idle = Math.sin(elapsed * 2.2) * (1 - walkBlend);
      const damagePulse = state.damaged ? Math.sin(elapsed * 42) * 0.22 + 0.28 : 0;
      const lowHealthPulse = state.lowHealth ? (Math.sin(elapsed * 7) + 1) * 0.08 : 0;

      motionRoot.position.y = PLAYER_MODEL_FLOOR_OFFSET + 0.04 + Math.abs(step) * 0.045 * walkBlend + idle * 0.018;
      motionRoot.rotation.x = -0.05 * walkBlend;
      spine.rotation.z = step * 0.055 * walkBlend;
      head.rotation.z = -step * 0.04 * walkBlend;

      leftLeg.group.rotation.x = step * 0.48 * walkBlend;
      rightLeg.group.rotation.x = counterStep * 0.48 * walkBlend;
      leftLeg.knee.rotation.x = Math.max(0, -counterStep) * 0.38 * walkBlend;
      rightLeg.knee.rotation.x = Math.max(0, -step) * 0.38 * walkBlend;

      leftArm.upper.rotation.x = -0.12 + counterStep * 0.08 * walkBlend;
      rightArm.upper.rotation.x = -0.14 + step * 0.05 * walkBlend - recoil * 0.06;
      leftArm.upper.rotation.y = 0.1;
      rightArm.upper.rotation.y = -0.08;
      leftArm.upper.rotation.z = -0.2;
      rightArm.upper.rotation.z = 0.18;
      leftArm.elbow.rotation.x = -0.12;
      rightArm.elbow.rotation.x = -0.08 - recoil * 0.08;
      weaponSocket.position.z = -0.28 - recoil * 0.08;

      materials.tealGlow.opacity = THREE.MathUtils.clamp(0.76 + lowHealthPulse + recoil * 0.24, 0.55, 1);
      materials.redGlow.opacity = THREE.MathUtils.clamp(0.58 + damagePulse + lowHealthPulse, 0.4, 1);
    },
  };
}

function createPlayerMaterials(texture: THREE.Texture): PlayerMaterials {
  return {
    armor: createRimmedArmorMaterial(texture, 0x7d878a, 0x2be8e0, 0.3),
    softSuit: createRimmedArmorMaterial(texture, 0x4c5356, 0x1da9b0, 0.16),
    darkMetal: createRimmedArmorMaterial(texture, 0x5e6669, 0x1fc9c6, 0.2),
    tealGlow: new THREE.MeshBasicMaterial({ color: 0x54f5ff, transparent: true, opacity: 0.82 }),
    redGlow: new THREE.MeshBasicMaterial({ color: 0xff3f4f, transparent: true, opacity: 0.62 }),
  };
}

function createRimmedArmorMaterial(
  texture: THREE.Texture,
  color: THREE.ColorRepresentation,
  rimColor: THREE.ColorRepresentation,
  rimStrength: number,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    color,
    roughness: 0.52,
    metalness: 0.62,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.playerRimColor = { value: new THREE.Color(rimColor) };
    shader.uniforms.playerRimStrength = { value: rimStrength };
    shader.fragmentShader = shader.fragmentShader.replace(
      "void main() {",
      `
      uniform vec3 playerRimColor;
      uniform float playerRimStrength;

      void main() {
      `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `
      #include <emissivemap_fragment>
      float playerRim = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.2);
      totalEmissiveRadiance += playerRimColor * playerRimStrength * playerRim;
      `,
    );
  };
  material.customProgramCacheKey = () => `player-rim-${rimStrength}`;

  return material;
}

function createLeg(side: "left" | "right", materials: PlayerMaterials) {
  const sign = side === "left" ? -1 : 1;
  const group = new THREE.Group();
  group.name = `${side}-hip-joint`;

  const thigh = mesh(`${side}-thigh`, new THREE.BoxGeometry(0.24, 0.46, 0.2), materials.softSuit);
  thigh.position.y = -0.24;
  group.add(thigh);

  const thighPlate = mesh(`${side}-thigh-plate`, new THREE.BoxGeometry(0.2, 0.32, 0.1), materials.armor);
  thighPlate.position.set(sign * 0.04, -0.23, -0.12);
  group.add(thighPlate);

  const knee = new THREE.Group();
  knee.name = `${side}-knee-joint`;
  knee.position.y = -0.5;
  group.add(knee);

  const kneePad = mesh(`${side}-knee-pad`, new THREE.BoxGeometry(0.24, 0.16, 0.16), materials.armor);
  kneePad.position.z = -0.13;
  knee.add(kneePad);

  const shin = mesh(`${side}-shin`, new THREE.BoxGeometry(0.22, 0.52, 0.18), materials.softSuit);
  shin.position.y = -0.27;
  knee.add(shin);

  const shinPlate = mesh(`${side}-shin-plate`, new THREE.BoxGeometry(0.18, 0.42, 0.1), materials.armor);
  shinPlate.position.set(sign * 0.03, -0.27, -0.12);
  knee.add(shinPlate);

  const foot = mesh(`${side}-boot`, new THREE.BoxGeometry(0.26, 0.16, 0.42), materials.armor);
  foot.position.set(0, -0.56, -0.06);
  knee.add(foot);
  addGlowBar(foot, materials.tealGlow, 0, 0.06, -0.22, 0.1, 0.025);

  return { group, knee };
}

function createArm(side: "left" | "right", materials: PlayerMaterials) {
  const sign = side === "left" ? -1 : 1;
  const upper = new THREE.Group();
  upper.name = `${side}-shoulder-joint`;

  const shoulder = mesh(`${side}-shoulder-pad`, new THREE.BoxGeometry(0.34, 0.18, 0.4), materials.armor);
  shoulder.position.set(sign * 0.03, 0.02, -0.01);
  upper.add(shoulder);

  const bicep = mesh(`${side}-upper-arm`, new THREE.BoxGeometry(0.16, 0.34, 0.16), materials.softSuit);
  bicep.rotation.z = sign * 0.12;
  bicep.position.set(sign * 0.1, -0.24, -0.08);
  upper.add(bicep);

  const elbow = new THREE.Group();
  elbow.name = `${side}-elbow-joint`;
  elbow.position.set(sign * 0.17, -0.44, -0.18);
  upper.add(elbow);

  const forearm = mesh(`${side}-forearm`, new THREE.BoxGeometry(0.17, 0.16, 0.46), materials.armor);
  forearm.position.set(sign * 0.04, -0.02, -0.22);
  elbow.add(forearm);
  addGlowBar(forearm, materials.tealGlow, 0, 0.02, -0.24, 0.1, 0.024);

  const handSocket = new THREE.Group();
  handSocket.name = `${side}-hand-weapon-socket`;
  handSocket.position.set(sign * 0.07, -0.02, -0.46);
  handSocket.rotation.set(0, sign * 0.04, 0);
  elbow.add(handSocket);

  const hand = mesh(`${side}-hand`, new THREE.BoxGeometry(0.13, 0.12, 0.14), materials.darkMetal);
  hand.position.z = -0.02;
  handSocket.add(hand);

  return { upper, elbow, handSocket };
}

function createBelt(materials: PlayerMaterials): THREE.Group {
  const group = new THREE.Group();
  group.name = "utility-belt";

  const belt = mesh("belt", new THREE.BoxGeometry(0.86, 0.13, 0.12), materials.darkMetal);
  belt.position.z = -0.18;
  group.add(belt);

  for (let i = -2; i <= 2; i += 1) {
    const pouch = mesh(`belt-pouch-${i}`, new THREE.BoxGeometry(0.13, 0.18, 0.11), materials.armor);
    pouch.position.set(i * 0.18, -0.02, -0.26);
    group.add(pouch);
  }

  return group;
}

function createPulseRifle(materials: PlayerMaterials): THREE.Group {
  const weapon = new THREE.Group();
  weapon.name = "pulse-rifle";
  weapon.position.set(0.02, -0.01, -0.3);
  weapon.rotation.y = -0.02;

  const receiver = mesh("rifle-receiver", new THREE.BoxGeometry(0.2, 0.16, 0.62), materials.darkMetal);
  receiver.position.z = -0.22;
  weapon.add(receiver);

  const barrel = mesh("rifle-barrel", new THREE.BoxGeometry(0.08, 0.08, 0.72), materials.darkMetal);
  barrel.position.z = -0.86;
  weapon.add(barrel);

  const stock = mesh("rifle-stock", new THREE.BoxGeometry(0.18, 0.13, 0.26), materials.armor);
  stock.position.z = 0.2;
  weapon.add(stock);

  const grip = mesh("rifle-grip", new THREE.BoxGeometry(0.08, 0.24, 0.1), materials.armor);
  grip.position.set(0.02, -0.18, -0.1);
  grip.rotation.x = -0.3;
  weapon.add(grip);

  const muzzleGlow = mesh("rifle-muzzle-glow", new THREE.BoxGeometry(0.1, 0.1, 0.035), materials.tealGlow);
  muzzleGlow.position.z = -1.24;
  weapon.add(muzzleGlow);
  addGlowBar(receiver, materials.tealGlow, 0, 0.06, -0.33, 0.1, 0.025);

  return weapon;
}

function addGlowBar(
  parent: THREE.Object3D,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
): void {
  const bar = mesh("glow-bar", new THREE.BoxGeometry(width, height, 0.018), material);
  bar.position.set(x, y, z);
  parent.add(bar);
}

function mesh<TGeometry extends THREE.BufferGeometry, TMaterial extends THREE.Material>(
  name: string,
  geometry: TGeometry,
  material: TMaterial,
): THREE.Mesh<TGeometry, TMaterial> {
  const object = new THREE.Mesh(geometry, material);
  object.name = name;
  return object;
}
