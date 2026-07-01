# Asset Editor

The asset editor is a dev-only GLB and sidecar editor. Open it at:

```text
/dev/asset-editor
```

Open a specific live asset with:

```text
/dev/asset-editor?asset=environment/industrial-crate
```

Staged assets copied from assetanvil can be opened with:

```text
/dev/asset-editor?asset=environment/industrial-crate&staged=1
```

The editor discovers `.glb` models under `public/assets/<category>/<asset-id>/` and `public/assets/_staged/<category>/<asset-id>/`. It loads `<asset-id>.asset.json` when present, otherwise it synthesizes editable defaults from the category and any legacy settings.

## Controls

- Asset: selects a live or staged GLB asset.
- Angle: switches between head-on, side, behind, and isometric camera presets.
- Camera Distance: moves the camera closer or farther along the current view direction.
- Animation: previews GLB animation clips through `THREE.AnimationMixer`.
- Render Mode: switches shaded, wireframe, and skeleton-helper inspection.
- Collision: edits the sidecar's single 2D circle radius with a numeric input or scene handle.
- Asset Settings: edits daemon gameplay metadata in the sidecar, including enemy gameplay, spawn weight, attacks, drops, pickup resources, health, and movement.

The save button writes `public/assets/.../<asset-id>.asset.json`. The GLB remains owned by assetanvil.

## Notes

Temporary screenshots and comparison artifacts should go in `tmp/`. The current runtime GLB pilot is `environment/industrial-crate`; expand runtime loading as additional promoted GLBs become available.
