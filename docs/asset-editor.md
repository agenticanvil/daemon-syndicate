# Asset Editor

The asset editor is a dev-only preview tool for inspecting game assets in isolation. Open it at:

```text
/dev/asset-editor
```

It renders gameplay assets with the same Three.js asset pipeline used by the game.

## Controls

- Asset: selects the asset to inspect, including the player, enemies, and pickups.
- Angle: switches between head-on, side, behind, and isometric camera presets.
- Camera Distance: moves the camera closer or farther along the current view direction. `Reset` returns to the standard preset distance and clears any custom drag orbit.
- Animation: previews the selected asset's available states.
- Playback: pauses or resumes animation updates.
- Speed: changes animation playback speed.

Drag horizontally on the preview canvas to orbit the camera around the asset. The camera readout changes to `Custom` while using a dragged orbit.

## Shareable State

The tool stores selected state in the URL query string, so useful views can be copied and reopened later. Supported parameters include:

- `asset`
- `angle`
- `state`
- `speed`
- `distance`
- `paused=1`

## Notes

Use this page for quick visual checks after changing asset geometry, materials, animation state handling, or inspection lighting. Temporary screenshots and comparison artifacts should go in `tmp/`.
