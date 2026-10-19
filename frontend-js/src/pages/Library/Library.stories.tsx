import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import {
  failing,
  hanging,
  LIBRARY_PATH,
  libraryHandler,
} from "../../testing/handlers";
import { aWireLibrary } from "../../testing/wire";
import { Library } from "./Library";

const PREFS_KEY = `omnibus.view_prefs::${LIBRARY_PATH}`;

const meta = {
  title: "Pages/Library",
  component: Library,
  // The three keys the page reads, so no story inherits another's prefs.
  beforeEach() {
    for (const key of [
      PREFS_KEY,
      "omnibus.view_prefs.last_library",
      "omnibus.landing_shelf",
    ]) {
      localStorage.removeItem(key);
    }
  },
} satisfies Meta<typeof Library>;

export default meta;
type Story = StoryObj<typeof meta>;

const requests: URLSearchParams[] = [];

export const Loaded: Story = {
  beforeEach({ msw }) {
    msw.use(libraryHandler(aWireLibrary(5), 3));
  },
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByRole("heading", { name: "Your Library" }),
    ).toBeInTheDocument();
    await expect(
      await canvas.findAllByRole("link", { name: /^Open details for/ }),
    ).toHaveLength(3);

    await userEvent.click(canvas.getByRole("button", { name: "Load more" }));

    await expect(
      await canvas.findByRole("link", {
        name: "Open details for Aurora Station, Vol. 5",
      }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  },
};

export const Empty: Story = {
  beforeEach({ msw }) {
    msw.use(libraryHandler([]));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("No ebooks found."),
    ).toBeInTheDocument();
  },
};

export const NoLibraryPath: Story = {
  beforeEach({ msw }) {
    msw.use(libraryHandler([], 3, { path: null }));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText(
        "Configure your ebook library path in Administration › Sources.",
      ),
    ).toBeInTheDocument();
  },
};

export const Failing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/ebooks", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn't load the library",
    );
  },
};

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/ebooks"));
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "Taking the books off the shelf",
    );
  },
};

export const SortSaves: Story = {
  beforeEach({ msw }) {
    requests.length = 0;
    msw.use(libraryHandler(aWireLibrary(5), 3, { requests }));
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findAllByRole("link", { name: /^Open details for/ });

    await userEvent.selectOptions(
      canvas.getByRole("combobox", { name: "Sort by" }),
      "Author",
    );

    await waitFor(() => {
      const last = requests.at(-1);
      expect(last?.get("sort")).toBe("author");
      expect(last?.get("dir")).toBe("asc");
    });
    await expect(localStorage.getItem(PREFS_KEY)).toContain(
      '"sort_key":"author"',
    );
  },
};

export const SortRestores: Story = {
  beforeEach({ msw }) {
    requests.length = 0;
    localStorage.setItem("omnibus.view_prefs.last_library", LIBRARY_PATH);
    localStorage.setItem(
      PREFS_KEY,
      '{"view_mode":"grid","sort_key":"author","sort_dir":"desc"}',
    );
    msw.use(libraryHandler(aWireLibrary(5), 3, { requests }));
  },
  play: async ({ canvas }) => {
    await canvas.findAllByRole("link", { name: /^Open details for/ });

    await expect(requests[0]?.get("sort")).toBe("author");
    await expect(requests[0]?.get("dir")).toBe("desc");
    await expect(
      canvas.getByRole("combobox", { name: "Sort by" }),
    ).toHaveDisplayValue("Author");
  },
};
