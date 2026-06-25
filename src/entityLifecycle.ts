import * as THREE from "three";

export function disposeObject3D(object: THREE.Object3D, disposeMaterials: boolean): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    if (!disposeMaterials) return;
    if (Array.isArray(child.material)) {
      child.material.forEach(disposeMaterial);
    } else {
      disposeMaterial(child.material);
    }
  });
}

export function disposeMesh(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
  disposeMeshMaterial(mesh);
}

export function disposeMeshGeometry(mesh: THREE.Mesh): void {
  mesh.geometry.dispose();
}

export function disposeMeshMaterial(mesh: THREE.Mesh): void {
  if (Array.isArray(mesh.material)) {
    mesh.material.forEach(disposeMaterial);
  } else {
    disposeMaterial(mesh.material);
  }
}

export function disposeMaterial(material: THREE.Material): void {
  const textures = new Set<THREE.Texture>();
  for (const value of Object.values(material)) {
    if (value instanceof THREE.Texture) {
      textures.add(value);
    }
  }
  textures.forEach((texture) => texture.dispose());
  material.dispose();
}
