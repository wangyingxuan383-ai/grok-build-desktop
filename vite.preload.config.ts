import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "out/preload",
    emptyOutDir: true,
    sourcemap: process.env.APP_BUILD_PROFILE === "local",
    target: "node24",
    lib: { entry: resolve("src/preload/index.ts"), formats: ["cjs"], fileName: () => "index.cjs" },
    rollupOptions: { external: ["electron", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)] },
  },
});
