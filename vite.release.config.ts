import { defineConfig } from "vite";
export default defineConfig({
  ssr: { noExternal: ["zod"] },
  build: {
    ssr: "src/host/server.ts",
    outDir: ".release-build",
    emptyOutDir: true,
    rolldownOptions: { output: { entryFileNames: "server.mjs" } },
  },
});
