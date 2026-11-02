import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/features/**/query.test.ts"],
    // The verify container runs the suite through an unmasked bind mount
    // of node_modules (the slow VM path on Docker Desktop): parallel fork
    // workers all cold-import vite/jsdom/React and starve at collection
    // ("No test suite found in file"). Serialized file execution is the
    // proven-green shape (38/38) and keeps `check.mjs all` deterministic.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "../../packages/app-contracts/src"),
    },
  },
});
