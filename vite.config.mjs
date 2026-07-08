import { defineConfig } from "vite";
import { daemonSyndicateAssetsPlugin } from "./scripts/assetPipeline.mjs";

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1500,
  },
  plugins: [daemonSyndicateAssetsPlugin()],
});
