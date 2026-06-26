import * as THREE from "three";

export type GraphicsSettings = {
  preserveDrawingBuffer: boolean;
  pixelRatio: 1 | 1.5 | 2;
};

export type RenderContext = {
  renderer: THREE.WebGLRenderer;
  camera: THREE.OrthographicCamera;
  resize: () => void;
  applyGraphicsSettings: (settings: GraphicsSettings) => void;
};

const DEFAULT_GRAPHICS_SETTINGS: GraphicsSettings = {
  preserveDrawingBuffer: true,
  pixelRatio: 2,
};

export function createRenderContext(app: HTMLDivElement): RenderContext {
  let graphicsSettings: GraphicsSettings = { ...DEFAULT_GRAPHICS_SETTINGS };
  let renderer = createRenderer(graphicsSettings);
  app.prepend(renderer.domElement);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  camera.position.set(25, 26, 25);
  camera.lookAt(0, 0, 0);

  function resize(): void {
    const aspect = window.innerWidth / window.innerHeight;
    const viewSize = window.innerWidth < 760 ? 28 : 24;
    camera.left = (-viewSize * aspect) / 2;
    camera.right = (viewSize * aspect) / 2;
    camera.top = viewSize / 2;
    camera.bottom = -viewSize / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  function applyGraphicsSettings(settings: GraphicsSettings): void {
    const shouldReplaceRenderer = settings.preserveDrawingBuffer !== graphicsSettings.preserveDrawingBuffer;
    graphicsSettings = { ...settings };

    if (shouldReplaceRenderer) {
      const previousRenderer = renderer;
      renderer = createRenderer(graphicsSettings);
      previousRenderer.domElement.replaceWith(renderer.domElement);
      previousRenderer.dispose();
      resize();
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, graphicsSettings.pixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  resize();

  return {
    get renderer() {
      return renderer;
    },
    camera,
    resize,
    applyGraphicsSettings,
  };
}

function createRenderer(settings: GraphicsSettings): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
    preserveDrawingBuffer: settings.preserveDrawingBuffer,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}
