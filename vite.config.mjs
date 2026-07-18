import { defineConfig } from "vite"

export default defineConfig({
  root: "prototype",
  base: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true
  }
})
