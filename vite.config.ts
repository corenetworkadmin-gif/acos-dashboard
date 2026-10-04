import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import { resolve } from "node:path";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "ACOS_");
  const port = Number(process.env.ACOS_PORT ?? env.ACOS_PORT ?? 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("ACOS_PORT must be a port from 1024 to 65535.");
  const hostApi = `http://127.0.0.1:${port}`;
  return {
    server: {
      host: "0.0.0.0",
      port: 8080,
      strictPort: true,
      proxy: {
        "/api": {
          target: hostApi,
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
          target: hostApi,
          timeout: 150000,
          proxyTimeout: 150000,
        },
      },
    },
    plugins: [react()],
    resolve: { alias: { "@": resolve(import.meta.dirname, "./src") } },
  };
});
