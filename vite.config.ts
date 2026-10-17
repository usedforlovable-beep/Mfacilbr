import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const androidBuild = process.env["BUILD_TARGET"]?.startsWith("android") ?? false;

export default defineConfig({
  base: androidBuild ? "./" : "/",
  server: {
    port: 8080,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
      },
    },
  },
  plugins: [
    tanstackStart({
      server: { entry: "server" },
      ...(androidBuild && {
        prerender: {
          enabled: true,
          autoSubfolderIndex: false,
          autoStaticPathsDiscovery: false,
          crawlLinks: false,
          failOnError: true,
        },
      }),
    }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
});
