import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The Windows integration suite launches real Git and ACP child processes.
    // Keep the release gate deterministic on developer machines with many cores.
    maxWorkers: 4,
    testTimeout: 20_000,
    coverage: { enabled: false },
  },
});
