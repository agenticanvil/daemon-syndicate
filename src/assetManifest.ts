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

type AssetSidecarMetadata = {
  schemaVersion: 1;
  id: string;
  category: AssetCategory;
  label: string;
  model: AssetModelMetadata;
  preview?: AssetPreviewMetadata;
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
  staged: boolean;
  sidecar: AssetSidecar;
};
