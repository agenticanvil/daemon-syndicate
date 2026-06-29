# Asset Creation Notes

This project favors procedural, low-poly, skinned Three.js enemy assets that can be inspected in the dev asset editor before they are used in gameplay.

## Goals

- Keep each enemy readable from the game's isometric camera first.
- Prefer one skinned surface mesh and one shared skeleton for small enemies.
- Use a single 512x512 texture atlas per enemy unless there is a strong reason to split materials.
- Keep enemy triangle budgets low enough for gameplay scale, but spend triangles where they improve silhouette and texture readability. A typical final target is roughly 500-1500 triangles unless the asset brief sets a stricter or looser budget.
- Keep one skinned mesh and one material when possible, and set the explicit triangle ceiling before modeling. Override the default range when creating a specific asset with different scale, rarity, or screen importance.
- Verify every asset in `/dev/asset-editor`, not only in code.

## Concept To Mesh

Start from concept art by identifying the parts that matter to gameplay readability:

- Overall footprint and height.
- Front/back direction.
- Primary attack shape.
- Distinct limb silhouette.
- Glow accents that help the player read weak points or facing.

Do not chase concept-art surface detail with geometry. Put scratches, panel lines, cables, hazard markings, and glow strips into the texture atlas. Spend triangles on silhouette: body profile, leg bends, spikes, and readable direction.

For a new enemy family, use `imagegen` in two stages:

1. Generate a small set of isometric character options on a plain background.
2. After choosing the direction, generate front, side, and back T-pose guide images and save them under `concept-art/`.

Do not use the concept image directly as the runtime texture. Treat it as a shape and material reference. The runtime asset still needs a purpose-built texture atlas and explicit UV placement.

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

The texture is sampled through explicit UV rectangles in the procedural mesh. Keep atlas regions named by material intent, such as `darkPlate`, `redOptic`, `blade`, and `cable`, so future geometry code stays readable.

Look at existing runtime atlas usage under `src/assets/` and matching texture files under `public/assets/`.

For more detailed enemies, define atlas rectangles in normal image coordinates and convert them to UV coordinates in one helper. This avoids the common mistake of mapping top-origin image coordinates directly into bottom-origin UV space.

Do not rely on vertex colors for textured character assets. Three.js multiplies the texture by vertex colors, which can crush contrast and make a good atlas look unused. Use the texture as the full albedo source, and use `MeshStandardMaterial.color` only for broad texture tinting when a whole material needs it. If a specific eye, core, mouth, or tail detail needs a color, map that part to the correct atlas island instead of tinting vertices.

When reviewing texture mapping, disable or ignore overlays that wash out the material, then inspect isometric, side, head-on, and behind views. Expect to loop through screenshots several times; broad surfaces can sample bland atlas regions even when the atlas itself has strong detail.

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

Avoid adding bones to solve purely visual shaping. Fixed mesh bends can be modeled inside a part bound to one bone. For example, a leg can have one animated bone while the mesh itself contains a fixed bend, blade, or toe shape.

For larger humanoid enemies, add bones only where animation needs them. Body, head, arm, claw, leg, foot, and tail segment bones can all drive one visible surface mesh. A segmented tail can be animated by several bones without making the renderable asset several meshes.

## Geometry

The rigged asset helper rigidly binds each part to a single bone and merges parts by material. Use that to make one skinned mesh from multiple procedural parts.

Guidelines:

- Keep body geometry closed. Open prism sides and inconsistent winding are very visible under the asset editor lights.
- Use custom `BufferGeometry` when primitive boxes/prisms do not create the needed silhouette.
- Use `DoubleSide` only when needed for thin, blade-like shapes; prefer closed geometry where possible.
- Different front and rear leg transforms are acceptable even when they share the same geometry helper.
- Rear legs usually need less backward sweep and more downward pitch than front legs, or they read as fins instead of supports.

Use a dedicated indexed `BufferGeometry` builder when an enemy has stricter topology requirements than the shared helper provides. If the brief requires one closed, connected surface, a custom builder is a better fit than a group of merged rigid parts.

For custom geometry, test topology instead of trusting the visual result:

- Indexed geometry.
- One connected vertex graph.
- No boundary edges.
- No inward-facing closed components.
- No geometry groups when one material/render call is required.
- `skinIndex` and `skinWeight` attributes present.
- No `color` vertex attribute for textured character meshes.
- Bounding box floor contact at `min.y = 0`.

Closed edge counts are not enough. A mesh can have no boundary edges and still look open if closed components have reversed winding and are culled by `FrontSide` rendering. Measure signed volume per closed component and flip inward-facing triangles before normals are computed. Avoid hiding winding problems with `DoubleSide` except for intentional thin blades.

Place the model on the floor in geometry space. If the feet or contact points are below the floor, lift the mesh as a rigid transform and move the matching skeleton pivots by the same amount so animation stays aligned.

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

Implement the standard enemy animation states for new enemies unless the gameplay design says otherwise:

- `idle`
- `walk`
- `melee`
- `death`

For melee-focused enemies, make the attack silhouette obvious from the isometric camera. Prefer large readable limb or body motion over a subtle hand motion.

## Asset Editor

Always wire new enemies into `/dev/asset-editor` early. The editor is the source of truth for:

- Whether the asset appears at the right scale.
- Whether the silhouette reads from isometric, side, head-on, and behind views.
- Whether animation states are selectable and loop correctly.
- Render calls and triangle count.
- Shaded and wireframe inspection.

Useful URL pattern:

```text
/dev/asset-editor?asset=<asset-id>&angle=isometric&state=idle&distance=0.70&speed=1.0
```

For a review loop, use fixed URLs for all important angles:

```text
/dev/asset-editor?asset=<asset-id>&angle=isometric&state=base-pose&speed=1.0
/dev/asset-editor?asset=<asset-id>&angle=side&state=base-pose&speed=1.0
/dev/asset-editor?asset=<asset-id>&angle=head-on&state=base-pose&speed=1.0
/dev/asset-editor?asset=<asset-id>&angle=behind&state=base-pose&speed=1.0
```

Capture screenshots into `tmp/` for comparisons. For example:

```text
tmp/<asset-id>-idle.png
tmp/<asset-id>-walk.png
tmp/<asset-id>-melee.png
tmp/<asset-id>-death.png
```

## Verification Checklist

Before considering an enemy asset done:

- `npm run build` passes.
- Relevant unit tests pass, including topology tests for custom single-surface geometry.
- The asset editor loads the enemy directly from the URL.
- The asset editor reports the expected render-call and triangle count.
- The model reads correctly from the isometric camera.
- Side, head-on, and behind views match the concept's major silhouette and accent placement.
- Front/back direction is clear.
- The texture atlas detail is visible on the head, body, limbs, tail, weapons, and other broad surfaces.
- Red optics, green cores, mouths, claws, and other key accent colors come from the correct atlas regions.
- Feet or contact points do not float during idle.
- Walk animation shows leg motion without destroying the silhouette.
- Attack animation clearly changes posture.
- Death animation collapses or disables the enemy readably.
- Screenshots are saved in `tmp/` for idle, walk, attack, and death.
- The enemy has a settings JSON beside its asset folder, uses `levelGrowth` and `levelSpeedGrowth`, and is discoverable by the asset editor.

## Examples

Use existing asset folders as implementation examples instead of copying snippets from this document.

- Enemy assets live under `src/assets/enemies/`.
- Environment assets live under `src/assets/environment/`.
- Pickup assets live under `src/assets/pickups/`.
- The player asset lives in `src/playerAsset.ts`.
- Runtime texture atlases live under `public/assets/`.

When adding a new enemy, create a folder under `src/assets/enemies/<asset-name>/` with the asset implementation and settings JSON beside each other. The asset editor discovers selectable assets from those folders, so keeping examples folder-based also keeps documentation aligned with the runtime structure.
