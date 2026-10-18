import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const apiPort = process.env.OMNIBUS_PORT ?? "3000";

export default defineConfig({
  plugins: [react()],
  server: {
    // Host stays the dev server's, so the API's Origin-vs-Host CSRF check
    // accepts cookie-authed POSTs (logout) without touching its allowlist.
    proxy: { "/api": { target: `http://127.0.0.1:${apiPort}` } },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/testing/setup.ts"],
  },
});
