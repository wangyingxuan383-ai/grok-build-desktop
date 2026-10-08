import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const profile = process.env.APP_BUILD_PROFILE === "local" ? "local" : "public";
const repository = "wangyingxuan383-ai/grok-build-desktop";
const commit = (process.env.GITHUB_SHA || process.env.GROK_DESKTOP_COMMIT || "working-tree").slice(0, 40);
const builtAt = process.env.GROK_DESKTOP_BUILD_TIME || new Date().toISOString();

export default defineConfig({
  define: {
    __GROK_BUILD_PROFILE__: JSON.stringify(profile),
    __GROK_BUILD_REPOSITORY__: JSON.stringify(repository),
    __GROK_BUILD_COMMIT__: JSON.stringify(commit),
    __GROK_BUILD_TIME__: JSON.stringify(builtAt),
  },
  build: {
    outDir: "out/main",
    emptyOutDir: true,
    sourcemap: profile === "local",
    target: "node24",
    lib: { entry: {index:resolve("src/main/index.ts"),"token-activity-worker":resolve("src/main/token-activity-worker.ts")}, formats: ["es"], fileName: (_format,name) => `${name}.js` },
    rollupOptions: { external: ["electron", "iconv-lite", "node-pty", "selfsigned", "qrcode", "bonjour-service", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)] },
  },
});
