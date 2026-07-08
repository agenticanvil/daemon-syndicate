# Asset Creation Notes

Assetanvil is the default home for visual asset creation. Daemon Syndicate owns gameplay metadata.

## Workflow

1. Create or import a visual model in `~/Developer/assetanvil`.
2. Export or normalize it as `assets/<asset-id>/<asset-id>.glb`.
3. Copy it into daemon staging:

```bash
cd ~/Developer/assetanvil
bun run export:daemon -- --asset industrial-crate --category environment
```

4. Open daemon's staged assets view:

```text
/dev/assets
```

5. Edit and save the daemon sidecar from the staged assets table:

```text
public/assets/_staged/environment/industrial-crate/industrial-crate.asset.json
```

6. Promote the staged GLB and sidecar into `public/assets/<category>/<asset-id>/` after validation.

## Conventions

- GLB file names are `<asset-id>.glb`.
- Daemon sidecars are `<asset-id>.asset.json`.
- Assetanvil metadata is `assetanvil.json`.
- Y is up.
- Feet/contact points sit at `y = 0` unless `model.floorOffset` is set.
- Forward is negative Z.
- Prefer embedded textures so copying a single GLB is enough.

Standard enemy clips:

```text
idle
walk
melee or attack
death
```

Standard player clips:

```text
idle
walk
fire
damaged
low-health
```

Useful socket names:

```text
socket.weapon
weapon-socket
socket.muzzle
```

## Verification

Before promoting an asset:

- `bun run typecheck` and `bun run build` pass in assetanvil.
- `bun run export:daemon -- --asset <asset-id> --category <category>` succeeds.
- `npm run build` and `npm test` pass in daemon.
- `/dev/asset-preview` loads the GLB and sidecar.
- Collision radius and gameplay settings save into `<asset-id>.asset.json`.
- Runtime loading is wired for that asset category before removing legacy procedural code.
