/** @type {import("@ladle/react").UserConfig} */
export default {
  stories: "src/**/*.stories.tsx",
  // Ladle runs its own Vite 6; the app's vite.config.ts is written for Vite 8.
  viteConfig: ".ladle/vite.config.mjs",
  outDir: "build-ladle",
  addons: { theme: { enabled: true, defaultState: "dark" } },
  // The app links its faces from index.html, which Ladle doesn't use.
  appendToHead: `
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400..700;1,400..700&family=Instrument+Sans:ital,wght@0,400..700;1,400..700&family=Space+Mono:ital,wght@0,400;0,700;1,400&display=swap" />`,
};
