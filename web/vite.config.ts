import { fileURLToPath, URL } from "node:url"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const backend = process.env.HOLTDROID_DEV_BACKEND ?? "http://localhost:8080"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  optimizeDeps: {
    exclude: ["@yume-chan/pcm-player"],
  },
  server: {
    proxy: {
      "/api": backend,
      "/s": { target: backend, ws: true },
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 800,
    emptyOutDir: true,
  },
})
