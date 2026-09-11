import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["{app,components,lib}/**/*.test.{ts,tsx}"],
    exclude: [...configDefaults.exclude, "dist/**", ".next/**", ".vinext/**"],
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["lib/**", "components/**"],
      exclude: ["**/*.test.*", "lib/storage/db.ts"],
    },
  },
});
