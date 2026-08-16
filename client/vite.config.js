import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const target = process.env.HEARTH_SERVER || "http://127.0.0.1:3928";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": target,
      "/uploads": target,
      "/ws": { target, ws: true },
    },
  },
  preview: {
    port: 5173,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
