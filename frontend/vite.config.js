import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Local API URL overrides must not change the endpoint expected by tests.
    env: { VITE_API_BASE: "http://localhost:8000" },
  },
});
