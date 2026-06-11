import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import * as devCerts from "office-addin-dev-certs";

export default defineConfig(async () => {
  const httpsOptions = await devCerts.getHttpsServerOptions();
  return {
    plugins: [react()],
    server: {
      https: httpsOptions,
      port: 5173,
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, "index.html"),
          dialog: path.resolve(__dirname, "dialog.html"),
        },
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@word-graph/shared": path.resolve(__dirname, "../packages/shared/src/index.ts"),
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
    },
  };
});
