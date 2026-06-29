import * as THREE from "three";

export type Vector3Tuple = [number, number, number];

export type BoneDefinition = {
  name: string;
  parent?: string;
  position?: Vector3Tuple;
};

export type RigidSkinnedPart<TMaterial extends string> = {
  name: string;
  bone: string;
  material: TMaterial;
  geometry: THREE.BufferGeometry;
  position?: Vector3Tuple;
  rotation?: Vector3Tuple;
  scale?: Vector3Tuple;
  color?: THREE.ColorRepresentation;
};

export type SocketDefinition = {
  name: string;
  bone: string;
  position?: Vector3Tuple;
  rotation?: Vector3Tuple;
};

export type RigidSkinnedAsset<TMaterial extends string> = {
  root: THREE.Group;
  bones: Record<string, THREE.Bone>;
  sockets: Record<string, THREE.Group>;
  meshes: Partial<Record<TMaterial, THREE.SkinnedMesh<THREE.BufferGeometry, THREE.Material>>>;
  skeleton: THREE.Skeleton;
};

export type StaticMergedPart<TMaterial extends string> = {
  name: string;
  material: TMaterial;
  geometry: THREE.BufferGeometry;
  position?: Vector3Tuple;
  rotation?: Vector3Tuple;
  scale?: Vector3Tuple;
  color?: THREE.ColorRepresentation;
};

type BucketGeometryInput = {
  geometry: THREE.BufferGeometry;
  transform: THREE.Matrix4;
  boneIndex?: number;
};

export function createRigidSkinnedAsset<TMaterial extends string>(definition: {
  name: string;
  bones: BoneDefinition[];
  parts: Array<RigidSkinnedPart<TMaterial>>;
  sockets?: SocketDefinition[];
  materials: Record<TMaterial, THREE.Material>;
}): RigidSkinnedAsset<TMaterial> {
  const root = new THREE.Group();
  root.name = definition.name;

  const bones: Record<string, THREE.Bone> = {};
  const orderedBones = definition.bones.map((boneDefinition) => {
    const bone = new THREE.Bone();
    bone.name = boneDefinition.name;
    setObjectTransform(bone, boneDefinition.position);
    bones[boneDefinition.name] = bone;
    return bone;
  });

  for (const boneDefinition of definition.bones) {
    const bone = bones[boneDefinition.name];
    const parent = boneDefinition.parent ? bones[boneDefinition.parent] : undefined;
    if (parent) {
      parent.add(bone);
    } else {
      root.add(bone);
    }
  }

  const sockets: Record<string, THREE.Group> = {};
  for (const socketDefinition of definition.sockets ?? []) {
    const socket = new THREE.Group();
    socket.name = socketDefinition.name;
    setObjectTransform(socket, socketDefinition.position, socketDefinition.rotation);
    bones[socketDefinition.bone].add(socket);
    sockets[socketDefinition.name] = socket;
  }

  root.updateMatrixWorld(true);

  const boneIndices = new Map(orderedBones.map((bone, index) => [bone.name, index]));
  const inputsByMaterial = new Map<TMaterial, BucketGeometryInput[]>();
  for (const part of definition.parts) {
    const bone = bones[part.bone];
    const boneIndex = boneIndices.get(part.bone);
    if (!bone || boneIndex === undefined) {
      throw new Error(`Unknown bone "${part.bone}" for part "${part.name}"`);
    }

    const transform = bone.matrixWorld.clone().multiply(localMatrix(part));
    const inputs = inputsByMaterial.get(part.material) ?? [];
    inputs.push({ geometry: part.geometry, transform, boneIndex });
    inputsByMaterial.set(part.material, inputs);
  }

  const skeleton = new THREE.Skeleton(orderedBones);
  skeleton.calculateInverses();

  const meshes: Partial<Record<TMaterial, THREE.SkinnedMesh<THREE.BufferGeometry, THREE.Material>>> = {};
  for (const [materialId, inputs] of inputsByMaterial) {
    const geometry = mergeGeometryInputs(inputs, orderedBones.length);
    const material = definition.materials[materialId];
    const skinnedMesh = new THREE.SkinnedMesh(geometry, material);
    skinnedMesh.name = `${definition.name}-${materialId}`;
    skinnedMesh.castShadow = true;
    skinnedMesh.receiveShadow = true;
    skinnedMesh.bind(skeleton);
    root.add(skinnedMesh);
    meshes[materialId] = skinnedMesh;
  }

  return { root, bones, sockets, meshes, skeleton };
}

export function createStaticMergedAsset<TMaterial extends string>(definition: {
  name: string;
  parts: Array<StaticMergedPart<TMaterial>>;
  materials: Record<TMaterial, THREE.Material>;
}): THREE.Group {
  const root = new THREE.Group();
  root.name = definition.name;

  const inputsByMaterial = new Map<TMaterial, BucketGeometryInput[]>();
  for (const part of definition.parts) {
    const inputs = inputsByMaterial.get(part.material) ?? [];
    inputs.push({ geometry: part.geometry, transform: localMatrix(part) });
    inputsByMaterial.set(part.material, inputs);
  }

  for (const [materialId, inputs] of inputsByMaterial) {
    const mesh = new THREE.Mesh(mergeGeometryInputs(inputs), definition.materials[materialId]);
    mesh.name = `${definition.name}-${materialId}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }

  return root;
}

function setObjectTransform(object: THREE.Object3D, position?: Vector3Tuple, rotation?: Vector3Tuple): void {
  if (position) object.position.fromArray(position);
  if (rotation) object.rotation.fromArray(rotation);
}

function localMatrix(transform: {
  position?: Vector3Tuple;
  rotation?: Vector3Tuple;
  scale?: Vector3Tuple;
}): THREE.Matrix4 {
  const position = new THREE.Vector3().fromArray(transform.position ?? [0, 0, 0]);
  const rotation = new THREE.Euler().fromArray([...(transform.rotation ?? [0, 0, 0]), "XYZ"]);
  const scale = new THREE.Vector3().fromArray(transform.scale ?? [1, 1, 1]);
  return new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromEuler(rotation), scale);
}

function mergeGeometryInputs(inputs: BucketGeometryInput[], boneCount = 0): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];

  for (const input of inputs) {
    const geometry = input.geometry.index ? input.geometry.toNonIndexed() : input.geometry.clone();
    geometry.applyMatrix4(input.transform);

    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const uv = geometry.getAttribute("uv");

    for (let index = 0; index < position.count; index += 1) {
      positions.push(position.getX(index), position.getY(index), position.getZ(index));
      if (normal) {
        normals.push(normal.getX(index), normal.getY(index), normal.getZ(index));
      } else {
        normals.push(0, 1, 0);
      }
      if (uv) {
        uvs.push(uv.getX(index), uv.getY(index));
      } else {
        uvs.push(0, 0);
      }

      if (boneCount > 0) {
        skinIndices.push(input.boneIndex ?? 0, 0, 0, 0);
        skinWeights.push(1, 0, 0, 0);
      }
    }

    geometry.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));

  if (boneCount > 0) {
    merged.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
    merged.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
  }

  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
