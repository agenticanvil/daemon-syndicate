import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { FXAAPass } from "three/examples/jsm/postprocessing/FXAAPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { CAMERA_VIEW_OFFSETS, DEFAULT_CAMERA_VIEW, type CameraViewMode } from "./gameCamera";

export type GraphicsSettings = {
  preserveDrawingBuffer: boolean;
  renderScale: RenderScale;
  cameraView: CameraViewMode;
};

type RenderScale = 0.25 | 0.5 | 1;

export type RenderContext = {
  renderer: THREE.WebGLRenderer;
  camera: THREE.Camera;
  cameraView: CameraViewMode;
  render: (scene: THREE.Scene, camera: THREE.Camera) => void;
  resize: () => void;
  applyGraphicsSettings: (settings: GraphicsSettings) => void;
};

type RendererSettings = Pick<GraphicsSettings, "preserveDrawingBuffer"> & {
  renderScale?: RenderScale;
  maxPixelRatio?: 1 | 1.5 | 2;
};

const POST_PROCESSING_FLAGS = {
  enabled: true,
  bloom: true,
  colorGrade: true,
  vignette: true,
  fxaa: true,
  chromaticAberration: false,
  filmGrain: false,
} as const;

const DEFAULT_GRAPHICS_SETTINGS: GraphicsSettings = {
  preserveDrawingBuffer: false,
  renderScale: 1,
  cameraView: DEFAULT_CAMERA_VIEW,
};

const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 200;

type RenderPipeline = {
  composer: EffectComposer;
  renderPass: RenderPass;
  fxaaPass?: FXAAPass;
  render: (scene: THREE.Scene, camera: THREE.Camera) => void;
  resize: (settings: RendererSettings) => void;
  dispose: () => void;
};

export function createRenderContext(app: HTMLDivElement): RenderContext {
  let graphicsSettings: GraphicsSettings = { ...DEFAULT_GRAPHICS_SETTINGS };
  let renderer = createRenderer(graphicsSettings);
  let pipeline = createRenderPipeline(renderer, graphicsSettings);
  app.prepend(renderer.domElement);

  const flatCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, CAMERA_NEAR, CAMERA_FAR);
  const depthCamera = new THREE.PerspectiveCamera(1, 1, CAMERA_NEAR, CAMERA_FAR);
  let activeCamera: THREE.Camera = cameraForView(graphicsSettings.cameraView);
  positionCamera(flatCamera, "flat");
  positionCamera(depthCamera, "depth");

  function resize(): void {
    const aspect = window.innerWidth / window.innerHeight;
    const viewSize = window.innerWidth < 760 ? 28 : 24;
    flatCamera.left = (-viewSize * aspect) / 2;
    flatCamera.right = (viewSize * aspect) / 2;
    flatCamera.top = viewSize / 2;
    flatCamera.bottom = -viewSize / 2;
    flatCamera.updateProjectionMatrix();
    depthCamera.aspect = aspect;
    depthCamera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(viewSize / (2 * CAMERA_VIEW_OFFSETS.depth.length())));
    depthCamera.updateProjectionMatrix();
    resizeRenderer(renderer, graphicsSettings);
    pipeline?.resize(graphicsSettings);
  }

  function applyGraphicsSettings(settings: GraphicsSettings): void {
    const shouldReplaceRenderer = settings.preserveDrawingBuffer !== graphicsSettings.preserveDrawingBuffer;
    const shouldSwitchCamera = settings.cameraView !== graphicsSettings.cameraView;
    graphicsSettings = { ...settings };
    if (shouldSwitchCamera) {
      const previousCamera = activeCamera;
      activeCamera = cameraForView(graphicsSettings.cameraView);
      activeCamera.position.copy(previousCamera.position);
      activeCamera.quaternion.copy(previousCamera.quaternion);
      activeCamera.up.copy(previousCamera.up);
    }

    if (shouldReplaceRenderer) {
      const previousRenderer = renderer;
      pipeline?.dispose();
      renderer = createRenderer(graphicsSettings);
      pipeline = createRenderPipeline(renderer, graphicsSettings);
      previousRenderer.domElement.replaceWith(renderer.domElement);
      previousRenderer.dispose();
      resize();
      return;
    }

    resizeRenderer(renderer, graphicsSettings);
    pipeline?.resize(graphicsSettings);
  }

  function render(scene: THREE.Scene, activeCamera: THREE.Camera): void {
    if (pipeline) {
      pipeline.render(scene, activeCamera);
    } else {
      renderer.render(scene, activeCamera);
    }
  }

  resize();

  return {
    get renderer() {
      return renderer;
    },
    get camera() {
      return activeCamera;
    },
    get cameraView() {
      return graphicsSettings.cameraView;
    },
    render,
    resize,
    applyGraphicsSettings,
  };

  function cameraForView(view: CameraViewMode): THREE.Camera {
    return view === "flat" ? flatCamera : depthCamera;
  }
}

function positionCamera(camera: THREE.Camera, view: CameraViewMode): void {
  camera.position.copy(CAMERA_VIEW_OFFSETS[view]);
  camera.lookAt(0, 0, 0);
}

export function createRenderer(settings: RendererSettings): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: settings.preserveDrawingBuffer,
  });
  resizeRenderer(renderer, settings);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

function createRenderPipeline(renderer: THREE.WebGLRenderer, settings: RendererSettings): RenderPipeline | undefined {
  if (!POST_PROCESSING_FLAGS.enabled) return undefined;

  const placeholderScene = new THREE.Scene();
  const placeholderCamera = new THREE.Camera();
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(placeholderScene, placeholderCamera);
  composer.addPass(renderPass);

  if (POST_PROCESSING_FLAGS.bloom) {
    const renderSize = renderBufferSize(settings);
    composer.addPass(
      new UnrealBloomPass(
        new THREE.Vector2(renderSize.width, renderSize.height),
        0.48,
        0.34,
        0.74,
      ),
    );
  }

  if (POST_PROCESSING_FLAGS.colorGrade || POST_PROCESSING_FLAGS.vignette) {
    composer.addPass(
      new ShaderPass({
        name: "DaemonColorGrade",
        uniforms: {
          tDiffuse: { value: null },
          contrast: { value: POST_PROCESSING_FLAGS.colorGrade ? 1.025 : 1 },
          saturation: { value: POST_PROCESSING_FLAGS.colorGrade ? 1.025 : 1 },
          highlightCyan: { value: POST_PROCESSING_FLAGS.colorGrade ? 0.008 : 0 },
          vignetteStrength: { value: POST_PROCESSING_FLAGS.vignette ? 0.12 : 0 },
          vignetteRadius: { value: 0.86 },
        },
        vertexShader: `
          varying vec2 vUv;

          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          uniform float contrast;
          uniform float saturation;
          uniform float highlightCyan;
          uniform float vignetteStrength;
          uniform float vignetteRadius;
          varying vec2 vUv;

          void main() {
            vec4 texel = texture2D(tDiffuse, vUv);
            vec3 color = (texel.rgb - 0.5) * contrast + 0.5;
            float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
            color = mix(vec3(luma), color, saturation);
            color.gb += vec2(highlightCyan * smoothstep(0.45, 1.0, luma));

            float distanceFromCenter = distance(vUv, vec2(0.5));
            float vignette = smoothstep(vignetteRadius, 0.28, distanceFromCenter);
            color *= mix(1.0 - vignetteStrength, 1.0, vignette);

            gl_FragColor = vec4(color, texel.a);
          }
        `,
      }),
    );
  }

  const fxaaPass = POST_PROCESSING_FLAGS.fxaa ? new FXAAPass() : undefined;
  if (fxaaPass) composer.addPass(fxaaPass);
  composer.addPass(new OutputPass());

  const pipeline: RenderPipeline = {
    composer,
    renderPass,
    fxaaPass,
    render(scene, camera) {
      renderPass.scene = scene;
      renderPass.camera = camera;
      composer.render();
    },
    resize(nextSettings) {
      settings = nextSettings;
      const renderSize = renderBufferSize(settings);
      composer.setPixelRatio(renderSize.pixelRatio);
      composer.setSize(renderSize.width, renderSize.height);
      if (fxaaPass) {
        fxaaPass.material.uniforms.resolution.value.set(
          1 / (renderSize.width * renderSize.pixelRatio),
          1 / (renderSize.height * renderSize.pixelRatio),
        );
      }
    },
    dispose() {
      composer.dispose();
    },
  };

  pipeline.resize(settings);
  return pipeline;
}

function resizeRenderer(renderer: THREE.WebGLRenderer, settings: RendererSettings): void {
  const renderSize = renderBufferSize(settings);
  renderer.setPixelRatio(renderSize.pixelRatio);
  renderer.setSize(renderSize.width, renderSize.height, settings.renderScale === undefined);
  if (settings.renderScale !== undefined) {
    renderer.domElement.style.width = "100vw";
    renderer.domElement.style.height = "100vh";
  }
}

function currentPixelRatio(settings: RendererSettings): number {
  return Math.min(window.devicePixelRatio, settings.maxPixelRatio ?? window.devicePixelRatio);
}

function renderBufferSize(settings: RendererSettings): { width: number; height: number; pixelRatio: number } {
  const pixelRatio = currentPixelRatio(settings);
  if (settings.renderScale === undefined) {
    return {
      width: Math.max(1, window.innerWidth),
      height: Math.max(1, window.innerHeight),
      pixelRatio,
    };
  }

  const nativeWidth = Math.max(1, Math.round(window.innerWidth * pixelRatio));
  const nativeHeight = Math.max(1, Math.round(window.innerHeight * pixelRatio));
  const width = Math.max(1, Math.round(nativeWidth * settings.renderScale));
  const height = Math.max(1, Math.round(nativeHeight * settings.renderScale));

  return {
    width,
    height,
    pixelRatio: 1,
  };
}
