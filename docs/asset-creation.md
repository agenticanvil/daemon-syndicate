# Asset Creation Notes

This project favors procedural, low-poly, skinned Three.js enemy assets that can be inspected in the dev asset editor before they are used in gameplay.

## Goals

- Keep each enemy readable from the game's isometric camera first.
- Prefer one skinned surface mesh and one shared skeleton for small enemies.
- Use a single 512x512 texture atlas per enemy unless there is a strong reason to split materials.
- Keep enemy triangle budgets low. For small enemies, start under 100 triangles for a blockout, then allow up to 200 triangles when silhouette or grounding needs it.
- Verify every asset in `/dev/asset-editor`, not only in code.

## Concept To Mesh

Start from concept art by identifying the parts that matter to gameplay readability:

- Overall footprint and height.
- Front/back direction.
- Primary attack shape.
- Distinct limb silhouette.
- Glow accents that help the player read weak points or facing.

Do not chase concept-art surface detail with geometry. Put scratches, panel lines, cables, hazard markings, and glow strips into the texture atlas. Spend triangles on silhouette: body profile, leg bends, spikes, and readable direction.

## Texture Atlas

Use `imagegen` for a square texture-atlas source, then resize to a project asset.

Good atlas prompts ask for material islands, not a character render:

- Dark armor panels.
- Scratched gunmetal.
- Red optic strips.
- Cyan/green glow panels.
- Cable/rubber strips.
- Blade metal.
- Small hazard marks.

Save generated atlas outputs under `public/assets/` for runtime use. Keep temporary sources and screenshots under `tmp/`.

For the lean hunter, the final runtime texture is:

```text
public/assets/lean-hunter-atlas.png
```

The texture is sampled through explicit UV rectangles in the procedural mesh. Keep atlas regions named by material intent, such as `darkPlate`, `redOptic`, `blade`, and `cable`, so future geometry code stays readable.

## Skeleton Design

Use the simplest skeleton that can express the gameplay motion.

For a small four-legged enemy, one leg bone per leg was enough:

```text
motion
  body
    head
    tail
    front-left-leg
    front-right-leg
    rear-left-leg
    rear-right-leg
```

Avoid adding bones to solve purely visual shaping. Fixed mesh bends can be modeled inside a part bound to one bone. This worked better for the lean hunter legs: each leg has one animated bone, while the mesh itself is a fixed L-shaped blade with a downward toe spike.

## Geometry

The rigged asset helper rigidly binds each part to a single bone and merges parts by material. Use that to make one skinned mesh from multiple procedural parts.

Guidelines:

- Keep body geometry closed. Open prism sides and inconsistent winding are very visible under the asset editor lights.
- Use custom `BufferGeometry` when primitive boxes/prisms do not create the needed silhouette.
- Use `DoubleSide` only when needed for thin, blade-like shapes; prefer closed geometry where possible.
- Different front and rear leg transforms are acceptable even when they share the same geometry helper.
- Rear legs usually need less backward sweep and more downward pitch than front legs, or they read as fins instead of supports.

For L-shaped legs, model the bend into the mesh:

- Base section starts at the body joint.
- Elbow section extends outward.
- Toe section drops down toward the floor.
- Spike tip continues slightly forward/down.

The bone then only needs to move the entire leg up/down and forward/back.

## Animation

Implement animation as deterministic bone transforms in the rig `update` method.

Recommended small-enemy states:

- `idle`
- `walk`
- `melee`
- `death`

Reset to a captured base pose before applying each frame's animation. This prevents accumulated rotations and position offsets.

For idle animation, do not bob the root or motion bone if feet are supposed to stay planted. Bob the body bone and counter-offset planted leg bones:

```ts
const bodyBob = 0.026 * Math.sin(elapsed * 2.4);
bones.body.position.y += bodyBob;
for (const leg of LEG_DEFINITIONS) {
  bones[`${leg.id}-leg`].position.y -= bodyBob;
}
```

This gives the body a mechanical breathing/sway motion without making the leg tips float.

## Asset Editor

Always wire new enemies into `/dev/asset-editor` early. The editor is the source of truth for:

- Whether the asset appears at the right scale.
- Whether the silhouette reads from isometric, side, head-on, and behind views.
- Whether animation states are selectable and loop correctly.
- Render calls and triangle count.
- Shaded and wireframe inspection.

Useful URL pattern:

```text
/dev/asset-editor?asset=lean-hunter&angle=isometric&state=idle&distance=0.70&speed=1.0
```

Capture screenshots into `tmp/` for comparisons. For example:

```text
tmp/lean-hunter-idle.png
tmp/lean-hunter-walk.png
tmp/lean-hunter-melee.png
tmp/lean-hunter-death.png
```

## Verification Checklist

Before considering an enemy asset done:

- `npm run build` passes.
- The asset editor loads the enemy directly from the URL.
- The asset editor reports the expected render-call and triangle count.
- The model reads correctly from the isometric camera.
- Front/back direction is clear.
- Feet or contact points do not float during idle.
- Walk animation shows leg motion without destroying the silhouette.
- Attack animation clearly changes posture.
- Death animation collapses or disables the enemy readably.
- Screenshots are saved in `tmp/` for idle, walk, attack, and death.

## Lean Hunter Baseline

The lean hunter is the current reference implementation for a small robot enemy.

Current characteristics:

- One skinned mesh.
- One material using `public/assets/lean-hunter-atlas.png`.
- One skeleton with body, head, tail, and four leg bones.
- Four animation states: `idle`, `walk`, `melee`, `death`.
- Fixed L-shaped leg meshes bound to single leg bones.
- Body idle bob with planted leg compensation.
- Asset editor readout: `1` render call, `150` triangles.
