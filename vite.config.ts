import { defineConfig } from "vitest/config";
import { viteSingleFile } from "vite-plugin-singlefile";

// Single self-contained HTML output (dist/index.html): no external requests,
// the most portable format for embedding into a hosted artifact.
export default defineConfig({
  base: "./",
  plugins: [viteSingleFile()],
  build: { target: "es2020", cssCodeSplit: false, assetsInlineLimit: 100_000_000 },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
