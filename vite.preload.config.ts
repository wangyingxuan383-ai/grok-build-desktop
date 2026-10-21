import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "out/preload",
    emptyOutDir: true,
    sourcemap: process.env.APP_BUILD_PROFILE === "local",
    target: "node24",
    lib: { entry: { index: resolve("src/preload/index.ts"), "quick-entry": resolve("src/preload/quick-entry.ts"), pet: resolve("src/preload/pet.ts") }, formats: ["cjs"], fileName: (_format, name) => `${name}.cjs` },
    rollupOptions: { external: ["electron", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)] },
  },
});
