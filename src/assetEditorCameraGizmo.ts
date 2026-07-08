import * as THREE from "three";

export type AngleId = "head-on" | "side" | "behind" | "isometric";

export type CameraGizmo = {
  render: (viewCamera: THREE.Camera, viewTarget: THREE.Vector3) => void;
  resize: () => void;
  dispose: () => void;
};

export const CAMERA_VIEW_RADIUS = 5.2;

export function createCameraGizmo(
  host: HTMLElement,
  onDirectionSelected: (direction: THREE.Vector3) => void,
): CameraGizmo {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  const root = new THREE.Group();
  scene.add(root);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x172222, 2.4));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
  keyLight.position.set(2.5, 3.5, 2);
  scene.add(keyLight);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pickables: Array<THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>> = [];
  let hovered: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null = null;

  const halfSize = 0.58;
  const faceGeometry = new THREE.PlaneGeometry(1.08, 1.08);
  const edgeThickness = 0.13;
  const edgeLength = 1.16;
  const faceColorByAxis = { x: 0xff7b73, y: 0x8bffb5, z: 0x7c95ff };
  const faceDirections = [
    { label: "RIGHT", direction: new THREE.Vector3(1, 0, 0), color: faceColorByAxis.x },
    { label: "LEFT", direction: new THREE.Vector3(-1, 0, 0), color: faceColorByAxis.x },
    { label: "TOP", direction: new THREE.Vector3(0, 1, 0), color: faceColorByAxis.y },
    { label: "BOTTOM", direction: new THREE.Vector3(0, -1, 0), color: faceColorByAxis.y },
    { label: "BACK", direction: new THREE.Vector3(0, 0, 1), color: faceColorByAxis.z },
    { label: "FRONT", direction: new THREE.Vector3(0, 0, -1), color: faceColorByAxis.z },
  ];

  for (const face of faceDirections) {
    const mesh = new THREE.Mesh(faceGeometry, createGizmoFaceMaterial(face.label, face.color));
    mesh.position.copy(face.direction).multiplyScalar(halfSize);
    orientObjectTowardDirection(mesh, face.direction);
    addGizmoPickable(root, pickables, mesh, face.direction);
  }

  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        const direction = new THREE.Vector3(x, y, z);
        const corner = new THREE.Mesh(
          new THREE.SphereGeometry(0.105, 18, 12),
          createGizmoHandleMaterial(0xf4fbff, 0.98),
        );
        corner.position.set(x * halfSize, y * halfSize, z * halfSize);
        addGizmoPickable(root, pickables, corner, direction);
      }
    }
  }

  for (const axis of ["x", "y", "z"] as const) {
    const geometry =
      axis === "x"
        ? new THREE.BoxGeometry(edgeLength, edgeThickness, edgeThickness)
        : axis === "y"
          ? new THREE.BoxGeometry(edgeThickness, edgeLength, edgeThickness)
          : new THREE.BoxGeometry(edgeThickness, edgeThickness, edgeLength);
    for (const a of [-1, 1]) {
      for (const b of [-1, 1]) {
        const direction =
          axis === "x" ? new THREE.Vector3(0, a, b) : axis === "y" ? new THREE.Vector3(a, 0, b) : new THREE.Vector3(a, b, 0);
        const edge = new THREE.Mesh(geometry, createGizmoHandleMaterial(0x1b2b2d, 0.95));
        edge.position.set(
          axis === "x" ? 0 : a * halfSize,
          axis === "y" ? 0 : (axis === "x" ? a : b) * halfSize,
          axis === "z" ? 0 : b * halfSize,
        );
        addGizmoPickable(root, pickables, edge, direction);
      }
    }
  }

  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.18, 1.18, 1.18)),
    new THREE.LineBasicMaterial({ color: 0xd7f5ff, transparent: true, opacity: 0.72 }),
  );
  root.add(outline);

  function setHovered(nextHovered: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null): void {
    if (hovered === nextHovered) return;
    if (hovered) applyGizmoHover(hovered, false);
    hovered = nextHovered;
    if (hovered) applyGizmoHover(hovered, true);
    host.classList.toggle("is-hovering", hovered !== null);
  }

  function pickGizmoObject(
    event: PointerEvent | MouseEvent,
  ): THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | null {
    pointerFromEvent(event, pointer, renderer.domElement);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(pickables, false)[0]?.object;
    return hit instanceof THREE.Mesh ? hit : null;
  }

  renderer.domElement.addEventListener("pointermove", (event) => setHovered(pickGizmoObject(event)));
  renderer.domElement.addEventListener("pointerleave", () => setHovered(null));
  renderer.domElement.addEventListener("pointerdown", (event) => event.preventDefault());
  renderer.domElement.addEventListener("click", (event) => {
    const direction = pickGizmoObject(event)?.userData.cameraDirection;
    if (direction instanceof THREE.Vector3) onDirectionSelected(direction);
  });

  function resize(): void {
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function render(viewCamera: THREE.Camera, viewTarget: THREE.Vector3): void {
    const viewDirection = viewCamera.position.clone().sub(viewTarget);
    if (viewDirection.lengthSq() < 0.001) viewDirection.set(1, 1, 1);
    camera.position.copy(viewDirection.normalize().multiplyScalar(4.2));
    lookAtWithStableVerticalUp(camera, new THREE.Vector3());
    renderer.render(scene, camera);
  }

  function dispose(): void {
    host.classList.remove("is-hovering");
    root.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        disposeGizmoMaterial(object.material);
      } else if (object instanceof THREE.Sprite) {
        disposeGizmoMaterial(object.material);
      }
    });
    renderer.dispose();
  }

  resize();
  return { render, resize, dispose };
}

export function cameraPositionForDirection(direction: THREE.Vector3, target: THREE.Vector3): THREE.Vector3 {
  const normalized = direction.clone().normalize();
  const position = target.clone().add(normalized.multiplyScalar(CAMERA_VIEW_RADIUS));
  if (Math.abs(direction.y) < 0.001) position.y = 1.65;
  return position;
}

export function angleForCameraDirection(direction: THREE.Vector3): AngleId | null {
  if (directionMatches(direction, new THREE.Vector3(0, 0, -1))) return "head-on";
  if (directionMatches(direction, new THREE.Vector3(1, 0, 0))) return "side";
  if (directionMatches(direction, new THREE.Vector3(0, 0, 1))) return "behind";
  if (directionMatches(direction, new THREE.Vector3(1, 1, -1))) return "isometric";
  return null;
}

export function lookAtWithStableVerticalUp(camera: THREE.Camera, target: THREE.Vector3): void {
  const horizontalDistance = Math.hypot(camera.position.x - target.x, camera.position.z - target.z);
  camera.up.set(0, horizontalDistance < 0.001 ? 0 : 1, horizontalDistance < 0.001 && camera.position.y >= target.y ? -1 : 0);
  camera.lookAt(target);
}

function addGizmoPickable(
  root: THREE.Group,
  pickables: Array<THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>,
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>,
  direction: THREE.Vector3,
): void {
  mesh.userData.cameraDirection = direction.clone();
  mesh.userData.baseColor = mesh.material.color.clone();
  mesh.userData.baseOpacity = mesh.material.opacity;
  pickables.push(mesh);
  root.add(mesh);
}

function createGizmoHandleMaterial(color: THREE.ColorRepresentation, opacity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    emissive: 0x06100f,
    roughness: 0.52,
    metalness: 0.14,
    transparent: true,
    opacity,
  });
}

function createGizmoFaceMaterial(label: string, color: THREE.ColorRepresentation): THREE.MeshStandardMaterial {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const baseColor = new THREE.Color(color);
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(
    0,
    `rgba(${Math.round(baseColor.r * 255)}, ${Math.round(baseColor.g * 255)}, ${Math.round(baseColor.b * 255)}, 0.86)`,
  );
  gradient.addColorStop(1, "rgba(238, 255, 252, 0.72)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(255, 255, 255, 0.42)";
  context.lineWidth = 8;
  context.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
  context.fillStyle = "rgba(244, 251, 255, 0.92)";
  context.font = "800 38px ui-sans-serif, system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return new THREE.MeshStandardMaterial({
    map: texture,
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0.08,
    transparent: true,
    opacity: 0.78,
    side: THREE.DoubleSide,
  });
}

function applyGizmoHover(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>, hovered: boolean): void {
  const baseColor = mesh.userData.baseColor;
  const baseOpacity = mesh.userData.baseOpacity;
  if (baseColor instanceof THREE.Color) mesh.material.color.copy(hovered ? new THREE.Color(0xffffff) : baseColor);
  mesh.material.emissive.setHex(hovered ? 0x9bf0df : 0x06100f);
  mesh.material.opacity = hovered ? 1 : typeof baseOpacity === "number" ? baseOpacity : mesh.material.opacity;
}

function orientObjectTowardDirection(object: THREE.Object3D, direction: THREE.Vector3): void {
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.clone().normalize());
}

function directionMatches(a: THREE.Vector3, b: THREE.Vector3): boolean {
  return a.clone().normalize().distanceTo(b.clone().normalize()) < 0.001;
}

function pointerFromEvent(event: PointerEvent | MouseEvent, target: THREE.Vector2, element: HTMLElement): void {
  const rect = element.getBoundingClientRect();
  target.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  target.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
}

function disposeGizmoMaterial(material: THREE.Material | THREE.Material[] | undefined): void {
  if (Array.isArray(material)) {
    material.forEach(disposeGizmoMaterial);
    return;
  }
  if (!material) return;
  for (const value of Object.values(material)) {
    if (value && typeof value === "object" && "isTexture" in value) {
      (value as THREE.Texture).dispose();
    }
  }
  material.dispose();
}
