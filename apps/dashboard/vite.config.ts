import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

const generated = ["src/routeTree.gen.ts"];

export default defineConfig({
  fmt: { ignorePatterns: generated },
  lint: {
    ignorePatterns: generated,
    plugins: ["react", "typescript", "oxc"],
    rules: {
      "react/rules-of-hooks": "error",
      "react/only-export-components": ["warn", { allowConstantExport: true }],
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: { typeAware: true, typeCheck: true },
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
  },
  // The router plugin generates src/routeTree.gen.ts and must run before React's.
  plugins: lazyPlugins(() => [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ]),
  server: {
    proxy: { "/api": `http://127.0.0.1:${process.env.RUNYARD_PORT ?? 7420}` },
  },
});
