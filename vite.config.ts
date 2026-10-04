import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { resolve } from "node:path";
export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4317",
        timeout: 150000,
        proxyTimeout: 150000,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4317",
        timeout: 150000,
        proxyTimeout: 150000,
      },
    },
  },
  plugins: [react()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "./src") } },
});
