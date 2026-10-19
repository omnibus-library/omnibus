import { fileURLToPath } from "node:url";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const apiPort = process.env.OMNIBUS_PORT ?? "3000";

export default defineConfig({
  plugins: [react()],
  // The release tag the image build sets, as the Rust build reads it.
  define: {
    __APP_VERSION__: JSON.stringify(
      process.env.OMNIBUS_VERSION?.trim() || "dev",
    ),
  },
  build: {
    rolldownOptions: {
      // The generated client declares a zod schema per wire type at module
      // scope; without this every one of them ships, used or not.
      treeshake: {
        moduleSideEffects: (id: string) => !id.includes("/src/api/generated/"),
      },
    },
  },
  server: {
    // Host stays the dev server's, so the API's Origin-vs-Host CSRF check
    // accepts cookie-authed POSTs (logout) without touching its allowlist.
    proxy: { "/api": { target: `http://127.0.0.1:${apiPort}` } },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.stories.tsx",
        "src/**/*.test.{ts,tsx}",
        "src/testing/**",
        "src/**/*.d.ts",
      ],
    },
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
          // Chromium under load drops the odd play function.
          retry: 1,
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
