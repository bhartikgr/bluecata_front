import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@capavate/cap-table-engine": path.resolve(__dirname, "../cap-table-engine/src/index.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    reporters: ["default"],
  },
});
