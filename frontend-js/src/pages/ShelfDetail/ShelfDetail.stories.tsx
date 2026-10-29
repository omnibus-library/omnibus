import type { Meta, StoryObj } from "@storybook/react-vite";
import { delay, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import { getGetShelfMockHandler404 } from "../../api/generated/omnibus.msw";
import { failing, hanging, shelfDetailHandlers } from "../../testing/handlers";
import { aWireShelfDetail } from "../../testing/wire";
import type { ShelfDetail } from "./ShelfDetail";
import {
  BOB,
  MEMBERS,
  NOT_ADMIN,
  shelfDetailMeta,
  writes,
} from "./shelfDetailMeta";

const meta = {
  ...shelfDetailMeta,
  title: "Pages/ShelfDetail",
} satisfies Meta<typeof ShelfDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

const action = (canvas: ReturnType<typeof within>, name: string) =>
  canvas.getByRole("button", { name });

export const Owner: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Winter reads" }),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("shelf-kicker")).toHaveTextContent(
      "Hand-picked shelfPrivate3 books",
    );
    await expect(canvas.getByTestId("shelf-owner")).toHaveTextContent(
      "Your shelf",
    );
    await expect(
      canvas.getByRole("navigation", { name: "Breadcrumb" }),
    ).toHaveTextContent("← All shelves");
    await expect(canvas.queryByRole("note")).toBeNull();
    await waitFor(() => expect(document.title).toBe("Omnibus | Winter reads"));
    // Add books waits until the members have landed.
    await waitFor(() =>
      expect(canvas.getByTestId("shelf-add-books")).toHaveAttribute(
        "aria-disabled",
        "false",
      ),
    );
    await expect(action(canvas, "Edit shelf")).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    await expect(
      action(canvas, "Edit shelf").classList.contains("primary"),
    ).toBe(false);
  },
};

export const AddBooksWaitsForMembers: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/shelves/:id/page"));
  },
  play: async ({ canvas, userEvent }) => {
    const add = await canvas.findByRole("button", { name: "Add books" });
    await expect(add).toHaveAttribute("aria-disabled", "true");
    await expect(add).toHaveAttribute(
      "title",
      "Still loading this shelf’s books…",
    );

    await userEvent.click(add);

    await expect(canvas.queryByRole("dialog")).toBeNull();
  },
};

export const Smart: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...shelfDetailHandlers(
        aWireShelfDetail({
          kind: "smart",
          match_mode: "any",
          description: "Cosy things.",
          rules: [
            { field: "tag", op: "is", value: "Fantasy" },
            { field: "year", op: "gte", value: "2020" },
          ],
        }),
        MEMBERS,
        writes,
      ),
    );
  },
  play: async ({ canvas }) => {
    const rules = await canvas.findByTestId("shelf-rules");
    await expect(rules).toHaveTextContent(
      "Books matching any ofTag is FantasyYear is at least 2020",
    );
    await expect(canvas.getByText("Cosy things.")).toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Add books" }),
    ).toBeNull();
    await expect(
      action(canvas, "Edit shelf").classList.contains("primary"),
    ).toBe(true);
  },
};

export const OtherReader: Story = {
  parameters: { user: NOT_ADMIN },
  beforeEach({ msw }) {
    msw.use(
      ...shelfDetailHandlers(
        aWireShelfDetail({ visibility: "public", ...BOB }),
        MEMBERS,
        writes,
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const note = await canvas.findByRole("note");
    await expect(note).toHaveTextContent(
      "You can’t edit this shelf — it belongs to bob.",
    );
    await expect(note).toHaveTextContent(
      "Only its owner or an admin can rename it, change its books, or delete it.",
    );
    await expect(canvas.getByTestId("shelf-owner")).toHaveTextContent(
      "Owned by",
    );
    await expect(canvas.getByTestId("shelf-owner-name")).toHaveTextContent(
      "bob",
    );
    for (const name of ["Add books", "Edit shelf", "More shelf actions"]) {
      const button = action(canvas, name);
      await expect(button).toHaveAttribute("aria-disabled", "true");
      await expect(button).toHaveAccessibleDescription(/You can’t edit/);
      await expect(button).toHaveAttribute(
        "title",
        "You can’t edit this shelf — it belongs to bob.",
      );
    }

    await userEvent.click(action(canvas, "Edit shelf"));
    await userEvent.click(action(canvas, "More shelf actions"));

    await expect(canvas.queryByRole("dialog")).toBeNull();
    await expect(canvas.queryByRole("menu")).toBeNull();
  },
};

export const AdminOnOthers: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...shelfDetailHandlers(aWireShelfDetail({ ...BOB }), MEMBERS, writes),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("shelf-owner")).toHaveTextContent(
      "Owned by",
    );
    await expect(canvas.getByTestId("shelf-owner-name")).toHaveTextContent(
      "bob",
    );
    await expect(canvas.queryByRole("note")).toBeNull();
    await expect(action(canvas, "Edit shelf")).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    await expect(action(canvas, "More shelf actions")).toHaveAttribute(
      "aria-disabled",
      "false",
    );
  },
};

export const Wishlist: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...shelfDetailHandlers(
        aWireShelfDetail({ kind: "wishlist", name: "Wishlist" }),
        MEMBERS,
        writes,
      ),
    );
  },
  play: async ({ canvas }) => {
    const note = await canvas.findByRole("note");
    await expect(note).toHaveTextContent("Your wishlist can’t be edited here.");
    await expect(canvas.getByTestId("shelf-owner")).toHaveTextContent(
      "Your shelf",
    );
    await expect(action(canvas, "Edit shelf")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  },
};

export const KoboToggle: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "More shelf actions" }),
    );
    const toggle = canvas.getByRole("menuitemcheckbox", {
      name: "Sync to my devices",
    });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(canvas.queryByTestId("shelf-kobo-badge")).toBeNull();

    await userEvent.click(toggle);

    await expect(
      await canvas.findByTestId("shelf-kobo-badge"),
    ).toHaveTextContent("Syncs to my devices");
    await expect(writes).toEqual([
      { op: "patch", body: { sync_to_kobo: true } },
    ]);
    await expect(canvas.queryByRole("menu")).toBeNull();

    await userEvent.click(action(canvas, "More shelf actions"));
    await expect(
      canvas.getByRole("menuitemcheckbox", { name: "Sync to my devices" }),
    ).toHaveAttribute("aria-checked", "true");
  },
};

export const KoboToggleFailing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("patch", "/api/shelves/:id", 500));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "More shelf actions" }),
    );

    await userEvent.click(
      canvas.getByRole("menuitemcheckbox", { name: "Sync to my devices" }),
    );

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn’t change Kobo sync: failed with 500",
    );
  },
};

const patches: string[] = [];

export const KoboTogglePending: Story = {
  beforeEach({ msw }) {
    patches.length = 0;
    msw.use(
      http.patch("/api/shelves/:id", async () => {
        patches.push("patch");
        await delay("infinite");
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const more = await canvas.findByRole("button", {
      name: "More shelf actions",
    });
    await userEvent.click(more);
    await userEvent.click(
      canvas.getByRole("menuitemcheckbox", { name: "Sync to my devices" }),
    );
    await waitFor(() => expect(patches).toHaveLength(1));

    await userEvent.click(more);
    const toggle = await canvas.findByRole("menuitemcheckbox", {
      name: "Sync to my devices",
    });
    await expect(toggle).toBeDisabled();
    await userEvent.click(toggle);
    await expect(patches).toHaveLength(1);
  },
};

export const EditSaved: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Edit shelf" }),
    );
    const dialog = await canvas.findByRole("dialog");
    const name = within(dialog).getByRole("textbox", { name: "Shelf name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Spring reads");

    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Spring reads" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("dialog")).toBeNull();
  },
};

const openDelete = async (
  canvas: ReturnType<typeof within>,
  userEvent: { click: (el: Element) => Promise<void> },
) => {
  await userEvent.click(
    await canvas.findByRole("button", { name: "More shelf actions" }),
  );
  await userEvent.click(canvas.getByRole("menuitem", { name: "Delete shelf" }));
  return canvas.findByRole("dialog", { name: "Delete shelf?" });
};

export const DeleteSuccess: Story = {
  play: async ({ canvas, userEvent }) => {
    const dialog = await openDelete(canvas, userEvent);
    await expect(dialog).toHaveTextContent(
      "Deleting “Winter reads” removes the shelf. Its books stay in your library. This can’t be undone.",
    );

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete" }),
    );

    await expect(
      await canvas.findByText("The shelves index"),
    ).toBeInTheDocument();
    await expect(writes).toEqual([{ op: "delete" }]);
  },
};

export const DeleteFailing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("delete", "/api/shelves/:id", 500));
  },
  play: async ({ canvas, userEvent }) => {
    const dialog = await openDelete(canvas, userEvent);

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete" }),
    );

    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Couldn’t delete this shelf: failed with 500",
    );
    await expect(
      within(dialog).getByRole("button", { name: "Delete" }),
    ).toBeEnabled();
    await expect(
      canvas.getByRole("heading", { level: 1, name: "Winter reads" }),
    ).toBeInTheDocument();
  },
};

export const DeleteWorkingIgnoresDismissal: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/shelves/:id", "delete"));
  },
  play: async ({ canvas, userEvent }) => {
    const dialog = await openDelete(canvas, userEvent);

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete" }),
    );
    await expect(
      await within(dialog).findByRole("button", { name: "Deleting…" }),
    ).toBeDisabled();
    await userEvent.keyboard("{Escape}");

    await expect(canvas.getByRole("dialog")).toBeInTheDocument();
  },
};

export const NotFound: Story = {
  beforeEach({ msw }) {
    msw.use(getGetShelfMockHandler404());
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Shelf not found.",
    );
    await expect(
      canvas.getByRole("link", { name: "Back to shelves" }),
    ).toHaveAttribute("href", "/shelves");
    await expect(
      canvas.getByRole("navigation", { name: "Breadcrumb" }),
    ).toBeInTheDocument();
  },
};

export const MalformedId: Story = {
  parameters: { path: "/shelves/0" },
  play: async ({ canvas }) => {
    // The default handlers answer any id, so a request would have drawn the shelf.
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Shelf not found.",
    );
  },
};

export const Failing: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/shelves/:id", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );
    await expect(
      canvas.getByRole("link", { name: "Back to shelves" }),
    ).toBeInTheDocument();
  },
};

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/shelves/:id"));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Opening the shelf"),
    ).toBeInTheDocument();
    await expect(
      canvas.getByRole("navigation", { name: "Breadcrumb" }),
    ).toBeInTheDocument();
  },
};
