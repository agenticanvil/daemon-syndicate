import type { AssetSettings } from "./assetSettings";

type AssetCategory = "player" | "enemies" | "pickups" | "environment";

type AssetModelMetadata = {
  file: string;
  scale?: number;
  rotationY?: number;
  floorOffset?: number;
};

type AssetPreviewMetadata = {
  targetY?: number;
  defaultAnimation?: string;
};

export type AssetBundledMaterial = {
  id: string;
  type: "shader";
  mesh: string;
  definition: string;
};

type CircleCollisionSettings = {
  type: "circle";
  radius: number;
};

type AssetSidecarMetadata = {
  schemaVersion: 1;
  id: string;
  category: AssetCategory;
  label: string;
  model: AssetModelMetadata;
  preview?: AssetPreviewMetadata;
  materials?: AssetBundledMaterial[];
  collision: CircleCollisionSettings;
};

type SidecarFor<TSettings extends AssetSettings> = Omit<TSettings, "collision"> & AssetSidecarMetadata;

export type AssetSidecar =
  | SidecarFor<Extract<AssetSettings, { kind: "enemy" }>>
  | SidecarFor<Extract<AssetSettings, { kind: "pickup" }>>
  | SidecarFor<Extract<AssetSettings, { kind: "player" }>>
  | SidecarFor<Extract<AssetSettings, { kind: "environment" }>>;

export type EditorAssetRecord = {
  id: string;
  category: AssetCategory;
  name: string;
  label: string;
  modelUrl: string;
  sidecarUrl: string;
  sidecarExists: boolean;
  sidecarError?: string;
  liveModelExists?: boolean;
  liveSidecarExists?: boolean;
  modelComparison?: AssetFileComparison;
  sidecarComparison?: AssetFileComparison;
  staged: boolean;
  sidecar: AssetSidecar;
};

type AssetFileComparison = {
  status: "missing" | "current" | "newer" | "older" | "changed";
  stagedUpdatedAt: string;
  liveUpdatedAt?: string;
};
