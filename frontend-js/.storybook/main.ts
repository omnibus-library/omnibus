import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.tsx"],
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    "@storybook/addon-vitest",
    "msw-storybook-addon",
  ],
  framework: { name: "@storybook/react-vite", options: {} },
  // MSW's worker script, kept out of the app's own public directory.
  staticDirs: ["./public"],
};

export default config;
