import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// dev: Vite serves on 5173, proxies /api to Go backend on 8080.
// build: outputs to dist/ which the Go binary embeds via //go:embed.
export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Inline assets under 4 KB so the compiled SPA is fewer files for
    // go:embed to ship. We don't use code-splitting — single bundle is
    // simpler and the SPA is small.
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        manualChunks: undefined,
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: false,
      },
    },
  },
});
