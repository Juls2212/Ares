import { defineConfig } from "vite";
import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: "src/renderer",
  plugins: [react(), tailwindcss()],
  build: {
    outDir: path.resolve(__dirname, ".vite/renderer/main_window")
  }
});
