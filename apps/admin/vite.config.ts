import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      "/socket.io": {
        target: "http://127.0.0.1:3001",
        ws: true,
      },
    },
  },
  preview: {
    port: 5173,
    strictPort: true,
    allowedHosts: [
      "gamingcontrol.onrender.com",
      "www.gamingcontrol.fpsystemlab.com",
      "gamingcontrol.fpsystemlab.com",
    ],
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      "/socket.io": {
        target: "http://127.0.0.1:3001",
        ws: true,
      },
    },
  },
});
