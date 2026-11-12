import type { Meta, StoryObj } from "@storybook/react-vite";
import { delay, HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import { nowSecs } from "../../format";
import {
  aWireNotificationConnection,
  type NotificationWrites,
  notificationHandlers,
} from "../../testing/adminHandlers";
import { deferred, failing, hanging } from "../../testing/handlers";
import { NotificationConnectionsCard } from "./NotificationConnectionsCard";

const LIST = "/api/admin/notifications/connections";

const writes: NotificationWrites = {
  created: [],
  updated: [],
  switched: [],
  deleted: [],
  tested: [],
};

/** How many times the list was read, for the story that holds the read after a switch. */
let reads = 0;

/** What the server records when ntfy turns the saved token away. */
const SIGN_IN_REFUSED =
  "ntfy refused the sign-in. Check the access token, or the username and password.";

/** One of each: delivered, failed with its reason, never sent, and turned off. */
const MIXED = () => [
  aWireNotificationConnection({
    id: 1,
    name: "Kitchen tablet",
    last_delivery: { at: nowSecs() - 3 * 3600, ok: true, error: null },
  }),
  aWireNotificationConnection(
    {
      id: 2,
      name: "Phone",
      last_delivery: { at: nowSecs() - 120, ok: false, error: SIGN_IN_REFUSED },
    },
    { server_url: "https://ntfy.example.com/sub", topic: "phone" },
  ),
  aWireNotificationConnection(
    { id: 3, name: "Laptop" },
    { auth: "none", token_set: false },
  ),
  aWireNotificationConnection({
    id: 4,
    name: "Shared topic",
    enabled: false,
    last_delivery: { at: nowSecs() - 86_400, ok: true, error: null },
  }),
];

const meta = {
  title: "Pages/Admin/NotificationConnectionsCard",
  component: NotificationConnectionsCard,
  beforeEach({ msw }) {
    for (const list of Object.values(writes)) list.length = 0;
    msw.use(...notificationHandlers(MIXED(), { writes }));
  },
} satisfies Meta<typeof NotificationConnectionsCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const row = async (canvas: ReturnType<typeof within>, name: string) =>
  canvas.findByRole("listitem", { name });

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging(LIST));
  },
  play: async ({ canvas }) => {
    const loading = await canvas.findByTestId("notifications-loading");
    await expect(loading).toHaveAttribute("role", "status");
    await expect(loading).toHaveTextContent(
      "Finding the notification connections",
    );
    // Unknown is not empty: no "no connections" claim, and nothing to add to yet.
    await expect(
      canvas.queryByTestId("notifications-empty"),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Add connection" }),
    ).not.toBeInTheDocument();
  },
};

export const Empty: Story = {
  beforeEach({ msw }) {
    msw.use(...notificationHandlers([], { writes }));
  },
  play: async ({ canvas }) => {
    const empty = await canvas.findByTestId("notifications-empty");
    await expect(empty).toHaveTextContent("No connections yet");
    await expect(empty).toHaveTextContent(
      "Add one to get a push notification through ntfy when something needs you.",
    );
    const add = canvas.getByRole("button", { name: "Add connection" });
    await expect(add).toHaveClass("primary");
    await expect(canvas.queryByRole("list")).not.toBeInTheDocument();
  },
};

export const LoadFailed: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", LIST, 500));
  },
  play: async ({ canvas }) => {
    const alert = await canvas.findByRole("alert");
    await expect(alert).toHaveTextContent(
      "Couldn’t read the notification connections: failed with 500",
    );
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    await expect(
      canvas.queryByTestId("notifications-empty"),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Add connection" }),
    ).not.toBeInTheDocument();
  },
};

export const TryAgainReadsTheListAgain: Story = {
  beforeEach({ msw }) {
    let reads = 0;
    msw.use(
      http.get(LIST, () =>
        ++reads === 1
          ? new HttpResponse("failed with 500", { status: 500 })
          : HttpResponse.json({
              connections: [aWireNotificationConnection()],
              available_events: ["request_needs_chooser"],
            }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Try again" }),
    );

    await row(canvas, "Phone");
    await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
  },
};

export const Loaded: Story = {
  play: async ({ canvas }) => {
    const list = await canvas.findByRole("list", {
      name: "Notification connections",
    });
    await expect(within(list).getAllByRole("listitem")).toHaveLength(4);

    const kitchen = await row(canvas, "Kitchen tablet");
    await expect(kitchen).toHaveTextContent("ntfy.sh/omnibus-requests");
    await expect(
      within(kitchen).getByTestId("notification-last-delivery"),
    ).toHaveTextContent("Delivered 3 hours ago");
    await expect(
      within(kitchen).getByRole("switch", {
        name: "Send notifications to Kitchen tablet",
      }),
    ).toBeChecked();

    const phone = await row(canvas, "Phone");
    await expect(phone).toHaveTextContent("ntfy.example.com/sub/phone");
    await expect(
      within(phone).getByTestId("notification-last-delivery"),
    ).toHaveTextContent("Failed 2 minutes ago");
    // The server's sentence, whole.
    await expect(
      within(phone).getByTestId("notification-delivery-error").textContent,
    ).toBe(SIGN_IN_REFUSED);

    const laptop = await row(canvas, "Laptop");
    await expect(
      within(laptop).getByTestId("notification-last-delivery"),
    ).toHaveTextContent("No deliveries yet");
    await expect(
      within(laptop).queryByTestId("notification-delivery-error"),
    ).not.toBeInTheDocument();

    const shared = await row(canvas, "Shared topic");
    await expect(
      within(shared).getByRole("switch", {
        name: "Send notifications to Shared topic",
      }),
    ).not.toBeChecked();
    await expect(
      within(shared).getByTestId("notification-last-delivery"),
    ).toHaveTextContent("Delivered 1 day ago");
    await expect(
      canvas.getByRole("button", { name: "Add connection" }),
    ).not.toHaveClass("primary");
  },
};

/** An error recorded before errors were sentences: a status line and the provider's raw body, with nowhere to break a line. */
const OLD_STYLE_ERROR = `the server answered 401 Unauthorized: {"code":40101,"http":401,"error":"unauthorized","link":"https://ntfy.sh/docs/publish/#authentication","detail":"${"x".repeat(140)}"}`;

export const KeepsALongOldStyleErrorInsideItsRow: Story = {
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 360 }}>
        <Story />
      </div>
    ),
  ],
  beforeEach({ msw }) {
    msw.use(
      ...notificationHandlers(
        [
          aWireNotificationConnection({
            id: 5,
            name: "Old phone",
            last_delivery: {
              at: nowSecs() - 600,
              ok: false,
              error: OLD_STYLE_ERROR,
            },
          }),
        ],
        { writes },
      ),
    );
  },
  play: async ({ canvas, canvasElement }) => {
    const old = await row(canvas, "Old phone");
    const error = within(old).getByTestId("notification-delivery-error");
    await expect(error.textContent).toBe(OLD_STYLE_ERROR);
    const card = canvasElement.querySelector<HTMLElement>(
      '[data-testid="notification-connections-card"]',
    );
    // Shown whole, it wraps inside the row rather than pushing the row or the card wider.
    for (const element of [error, old, card]) {
      await expect(element?.scrollWidth).toBeLessThanOrEqual(
        element?.clientWidth ?? 0,
      );
    }
  },
};

export const TurnsAConnectionOff: Story = {
  play: async ({ canvas, userEvent }) => {
    const kitchen = await row(canvas, "Kitchen tablet");
    const toggle = within(kitchen).getByRole("switch", {
      name: "Send notifications to Kitchen tablet",
    });
    await userEvent.click(toggle);

    // The switch alone is sent, never the rest of the connection as this page last read it.
    await waitFor(() => expect(writes.switched).toHaveLength(1));
    await expect(writes.switched).toEqual([
      {
        method: "PATCH",
        path: "/api/admin/notifications/connections/1",
        body: { enabled: false },
      },
    ]);
    await expect(writes.updated).toEqual([]);
    await waitFor(() => expect(toggle).not.toBeChecked());
    await waitFor(() => expect(toggle).toBeEnabled());
  },
};

export const ShowsTheConnectionAsTheServerHoldsItAfterTheSwitch: Story = {
  beforeEach({ msw }) {
    reads = 0;
    msw.use(
      // The page read the list before another admin renamed the kitchen tablet and moved its
      // topic. The read after the switch never answers, so only the PATCH's answer can carry
      // the new name to the row.
      http.get(LIST, async () => {
        reads += 1;
        if (reads > 1) await delay("infinite");
        return HttpResponse.json({
          connections: MIXED(),
          available_events: ["request_needs_chooser"],
        });
      }),
      http.patch(`${LIST}/:id`, () =>
        HttpResponse.json(
          aWireNotificationConnection(
            {
              id: 1,
              name: "Hall tablet",
              enabled: false,
              last_delivery: {
                at: nowSecs() - 3 * 3600,
                ok: true,
                error: null,
              },
            },
            { topic: "omnibus-hall" },
          ),
        ),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const kitchen = await row(canvas, "Kitchen tablet");
    await userEvent.click(
      within(kitchen).getByRole("switch", {
        name: "Send notifications to Kitchen tablet",
      }),
    );

    const hall = await row(canvas, "Hall tablet");
    // The list's own read after the switch went out and is still held.
    await waitFor(() => expect(reads).toBe(2));
    await expect(hall).toHaveTextContent("ntfy.sh/omnibus-hall");
    await expect(
      within(hall).getByRole("switch", {
        name: "Send notifications to Hall tablet",
      }),
    ).not.toBeChecked();
    await expect(
      canvas.queryByRole("listitem", { name: "Kitchen tablet" }),
    ).not.toBeInTheDocument();
  },
};

export const ShowsTheSwitchMovingWhileItSaves: Story = {
  beforeEach({ msw }) {
    const gate = deferred();
    msw.use(
      http.patch(`${LIST}/:id`, async () => {
        await gate.promise;
        return new HttpResponse(null, { status: 500 });
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const kitchen = await row(canvas, "Kitchen tablet");
    const toggle = within(kitchen).getByRole("switch", {
      name: "Send notifications to Kitchen tablet",
    });
    await userEvent.click(toggle);

    await waitFor(() => expect(toggle).toHaveAttribute("aria-busy", "true"));
    await expect(toggle).not.toBeChecked();
    await expect(toggle).toBeDisabled();
  },
};

export const SaysWhyTurningOffFailed: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.patch(
        `${LIST}/:id`,
        () => new HttpResponse("database is locked", { status: 500 }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const kitchen = await row(canvas, "Kitchen tablet");
    const toggle = within(kitchen).getByRole("switch", {
      name: "Send notifications to Kitchen tablet",
    });
    await userEvent.click(toggle);

    await expect(
      await within(kitchen).findByText(
        "Couldn’t turn off Kitchen tablet: database is locked",
      ),
    ).toHaveClass("settings-status", "error");
    await waitFor(() => expect(toggle).toBeChecked());
  },
};

export const TestsASavedConnection: Story = {
  play: async ({ canvas, userEvent }) => {
    const phone = await row(canvas, "Phone");
    await userEvent.click(
      within(phone).getByRole("button", { name: "Test Phone" }),
    );

    await within(phone).findByText("Test notification sent.");
    await expect(writes.tested).toEqual([
      {
        id: 2,
        settings: {
          kind: "ntfy",
          server_url: "https://ntfy.example.com/sub",
          topic: "phone",
          auth: "token",
          priority: 3,
          tags: [],
          include_details: true,
        },
      },
    ]);
  },
};

export const DeletesAfterAsking: Story = {
  play: async ({ canvas, userEvent }) => {
    const laptop = await row(canvas, "Laptop");
    await userEvent.click(
      within(laptop).getByRole("button", { name: "Delete Laptop" }),
    );

    const dialog = await canvas.findByRole("dialog", {
      name: "Delete Laptop?",
    });
    await expect(dialog).toHaveTextContent(
      "Omnibus stops sending to ntfy.sh/omnibus-requests",
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete connection" }),
    );

    await canvas.findByText("Laptop deleted.");
    await expect(writes.deleted).toEqual([3]);
    await expect(
      canvas.queryByRole("listitem", { name: "Laptop" }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        canvas.getByRole("button", { name: "Add connection" }),
      ).toHaveFocus(),
    );
  },
};

export const CancellingADeleteKeepsIt: Story = {
  play: async ({ canvas, userEvent }) => {
    const laptop = await row(canvas, "Laptop");
    const remove = within(laptop).getByRole("button", {
      name: "Delete Laptop",
    });
    await userEvent.click(remove);
    const dialog = await canvas.findByRole("dialog", {
      name: "Delete Laptop?",
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );

    await expect(dialog).not.toBeInTheDocument();
    await expect(writes.deleted).toEqual([]);
    await expect(laptop).toBeInTheDocument();
    await waitFor(() => expect(remove).toHaveFocus());
  },
};

export const ReadsTheListAgainWhenOneIsGone: Story = {
  beforeEach({ msw }) {
    let reads = 0;
    msw.use(
      http.get(LIST, () => {
        // Every read after the first is after someone else deleted the kitchen tablet.
        const first = ++reads === 1;
        return HttpResponse.json({
          connections: MIXED().filter((c) => first || c.id !== 1),
          available_events: ["request_needs_chooser"],
        });
      }),
      http.patch(
        `${LIST}/:id`,
        () =>
          new HttpResponse("notification connection not found", {
            status: 404,
          }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const kitchen = await row(canvas, "Kitchen tablet");
    await userEvent.click(
      within(kitchen).getByRole("switch", {
        name: "Send notifications to Kitchen tablet",
      }),
    );

    await canvas.findByText(
      "Kitchen tablet had already been deleted, so the list has been read again.",
    );
    await waitFor(() =>
      expect(
        canvas.queryByRole("listitem", { name: "Kitchen tablet" }),
      ).not.toBeInTheDocument(),
    );
  },
};
