import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve("src/renderer"),
  base: "./",
  plugins: [react()],
  resolve: { alias: { "@renderer": resolve("src/renderer/src"), "@shared": resolve("src/shared") } },
  build: {
    outDir: resolve("out/renderer"), emptyOutDir: true, target: "chrome150",
    rolldownOptions: { output: { codeSplitting: { groups: [{
      // Stable shared runtime; feature chunks retain their own lazy boundaries.
      name: "react-runtime",
      test: /[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
    }] } } },
  },
});
