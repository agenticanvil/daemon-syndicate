import type { AssetSettings } from "./assetSettings";

export type AssetCategory = "player" | "enemies" | "pickups" | "environment";

export type AssetModelMetadata = {
  file: string;
  scale?: number;
  rotationY?: number;
  floorOffset?: number;
};

export type AssetPreviewMetadata = {
  targetY?: number;
  defaultAnimation?: string;
};

export type CircleCollisionSettings = {
  type: "circle";
  radius: number;
};

export type AssetSidecarBase = Omit<AssetSettings, "collision"> & {
  schemaVersion: 1;
  id: string;
  category: AssetCategory;
  label: string;
  model: AssetModelMetadata;
  preview?: AssetPreviewMetadata;
  collision: CircleCollisionSettings;
};

export type AssetSidecar = AssetSidecarBase;

export type EditorAssetRecord = {
  id: string;
  category: AssetCategory;
  name: string;
  label: string;
  modelUrl: string;
  sidecarUrl: string;
  sidecarExists: boolean;
  staged: boolean;
  sidecar: AssetSidecar;
};
