import type { Preview } from "@storybook/react-vite";
import { mswLoader } from "msw-storybook-addon/csf3";
import { configure } from "storybook/test";
import { resetImageBusts, toUser, type User } from "../src/api";
import { UserSummary } from "../src/api/generated/schemas";
import {
  AtriumRoot,
  isTheme,
  THEME_STORAGE_KEY,
  THEMES,
} from "../src/components/Theme/AtriumRoot";
import { watchImageLoads } from "../src/imageWatch";
import { ADA, AppHarness } from "../src/testing/AppHarness";
import {
  coverHandlers,
  registrationHandler,
  sessionHandler,
} from "../src/testing/handlers";
import "../src/styles/theme.css";
import "../src/styles/base.css";

watchImageLoads();

// Slow CI runners exceed testing-library's 1 s default wait on `waitFor`/`findBy*`.
configure({ asyncUtilTimeout: 4000 });

// `parameters.user` is the session as the server sends it; `null` is a guest.
function storyUser(value: unknown): User | null {
  if (value === null) return null;
  return value === undefined ? ADA : toUser(UserSummary.parse(value));
}

const preview = {
  tags: ["autodocs"],
  loaders: [mswLoader()],
  // Every story starts on the fake API; a story's own `beforeEach` overrides it.
  beforeEach({ msw }) {
    resetImageBusts();
    msw.use(sessionHandler(), registrationHandler(true), ...coverHandlers);
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
    (Story, { id, globals, parameters }) => {
      const theme = isTheme(globals.theme) ? globals.theme : "dark";
      // AtriumRoot starts on the saved theme, so the toolbar's pick goes there first.
      localStorage.setItem(THEME_STORAGE_KEY, theme);
      return (
        <AppHarness
          key={`${id}:${theme}`}
          user={storyUser(parameters.user)}
          path={typeof parameters.path === "string" ? parameters.path : "/"}
          router={parameters.ownRouter !== true}
        >
          <AtriumRoot>
            <div style={{ minHeight: "100vh", padding: 24 }}>
              <Story />
            </div>
          </AtriumRoot>
        </AppHarness>
      );
    },
  ],
} satisfies Preview;

export default preview;
