import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { failing, hanging, libraryHandler } from "../../testing/handlers";
import { aWireLibrary } from "../../testing/wire";
import { Library } from "./Library";

const meta = {
  title: "Pages/Library",
  component: Library,
} satisfies Meta<typeof Library>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
  beforeEach({ msw }) {
    msw.use(libraryHandler(aWireLibrary(5), 3));
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByText("· 5 books")).toBeInTheDocument();
    await expect(
      canvas.getAllByRole("link", { name: /^Open details for/ }),
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
    await expect(await canvas.findByText(/No books yet/)).toBeInTheDocument();
    await expect(canvas.getByText("· 0 books")).toBeInTheDocument();
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
    // Unknown is not empty: no count until the list answers.
    await expect(canvas.getByText("counting")).toBeInTheDocument();
  },
};
