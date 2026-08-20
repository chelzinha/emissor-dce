import { resolve } from "node:path";
import { defineConfig } from "vite";
import netlify from "@netlify/vite-plugin";

export default defineConfig({
  plugins: [netlify()],
  build: {
    rollupOptions: {
      input: {
        dce: resolve(__dirname, "index.html"),
        eleicoes: resolve(__dirname, "eleicoes.html"),
      },
    },
  },
  server: {
    port: 5173,
  },
});
