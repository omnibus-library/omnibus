import { fileURLToPath } from "node:url";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
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
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          setupFiles: ["./src/testing/setup.ts"],
        },
      },
      {
        // Every story renders as a test in Chromium; its `play` is the test body.
        extends: true,
        plugins: [
          storybookTest({
            configDir: fileURLToPath(new URL(".storybook", import.meta.url)),
          }),
        ],
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
