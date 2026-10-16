import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The viewer is served by `aa serve` from dist/ at `/`; in dev, API calls go to the engine on :8080.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: { proxy: { "/v1": "http://127.0.0.1:8080" } },
});
