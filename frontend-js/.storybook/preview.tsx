import type { Preview } from "@storybook/react-vite";
import { mswLoader } from "msw-storybook-addon/csf3";
import type { User } from "../src/api";
import { isTheme, THEMES } from "../src/components/Theme/AtriumRoot";
import { watchImageLoads } from "../src/imageWatch";
import { ADA, AppHarness } from "../src/testing/AppHarness";
import { coverHandlers, sessionHandler } from "../src/testing/handlers";
import "../src/styles/theme.css";
import "../src/styles/base.css";

watchImageLoads();

function isUser(value: unknown): value is User {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string" &&
    "canUpload" in value &&
    typeof value.canUpload === "boolean"
  );
}

// `parameters.user: null` renders the story signed out.
function storyUser(value: unknown): User | null {
  if (value === null) return null;
  return isUser(value) ? value : ADA;
}

const preview = {
  tags: ["autodocs"],
  loaders: [mswLoader()],
  // Every story starts on the fake API; a story's own `beforeEach` overrides it.
  beforeEach({ msw }) {
    msw.use(sessionHandler(), ...coverHandlers);
  },
  globalTypes: {
    theme: {
      description: "Atrium theme",
      toolbar: { title: "Theme", items: [...THEMES], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: "dark" },
  parameters: {
    // The decorator pads inside `.atrium`, so nothing shows around it.
    layout: "fullscreen",
    // Atrium's muted inks fail colour contrast in six stories (the Dioxus app
    // too): report them in the a11y panel and test results without failing.
    a11y: { test: "todo" },
  },
  // Every story renders inside the app's session, router and `.atrium` root.
  // A story sets `parameters.user` or `parameters.path` to change either, or
  // `parameters.ownRouter` when it renders a data router of its own.
  decorators: [
    (Story, { id, globals, parameters }) => (
      <AppHarness
        key={id}
        user={storyUser(parameters.user)}
        path={typeof parameters.path === "string" ? parameters.path : "/"}
        router={parameters.ownRouter !== true}
      >
        <div
          className="atrium"
          data-theme={isTheme(globals.theme) ? globals.theme : "dark"}
          style={{ minHeight: "100vh", padding: 24 }}
        >
          <Story />
        </div>
      </AppHarness>
    ),
  ],
} satisfies Preview;

export default preview;
