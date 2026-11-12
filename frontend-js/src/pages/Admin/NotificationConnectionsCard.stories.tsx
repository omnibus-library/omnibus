import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
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
  deleted: [],
  tested: [],
};

const LONG_ERROR =
  'the server answered 401 Unauthorized: {"code":40101,"http":401,"error":"unauthorized","link":"https://ntfy.sh/docs/publish/#authentication","detail":"the access token was rejected"}';

/** One of each: delivered, failed with a long reason, never sent, and turned off. */
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
      last_delivery: { at: nowSecs() - 120, ok: false, error: LONG_ERROR },
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
    last_delivery: {
      at: nowSecs() - 86_400,
      ok: false,
      error: "not sent: the connection is turned off",
    },
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
  play: async ({ canvas, userEvent }) => {
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
    const error = within(phone).getByTestId("notification-delivery-error");
    await expect(error).not.toHaveTextContent("the access token was rejected");
    await userEvent.click(
      within(error).getByRole("button", { name: "Show all" }),
    );
    await expect(error).toHaveTextContent(LONG_ERROR);
    await expect(
      within(error).getByRole("button", { name: "Show less" }),
    ).toHaveAttribute("aria-expanded", "true");

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
    await expect(shared).toHaveTextContent(
      "not sent: the connection is turned off",
    );
    await expect(
      canvas.getByRole("button", { name: "Add connection" }),
    ).not.toHaveClass("primary");
  },
};

export const TurnsAConnectionOff: Story = {
  play: async ({ canvas, userEvent }) => {
    const kitchen = await row(canvas, "Kitchen tablet");
    const toggle = within(kitchen).getByRole("switch", {
      name: "Send notifications to Kitchen tablet",
    });
    await userEvent.click(toggle);

    await waitFor(() => expect(writes.updated).toHaveLength(1));
    await expect(writes.updated[0]).toEqual({
      id: 1,
      body: {
        name: "Kitchen tablet",
        enabled: false,
        events: ["request_needs_chooser"],
        settings: {
          kind: "ntfy",
          server_url: "https://ntfy.sh",
          topic: "omnibus-requests",
          auth: "token",
          priority: 3,
          tags: [],
          include_details: true,
        },
      },
    });
    await waitFor(() => expect(toggle).not.toBeChecked());
    await expect(toggle).toBeEnabled();
  },
};

export const ShowsTheSwitchMovingWhileItSaves: Story = {
  beforeEach({ msw }) {
    const gate = deferred();
    msw.use(
      http.put(`${LIST}/:id`, async () => {
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

    await expect(toggle).not.toBeChecked();
    await expect(toggle).toBeDisabled();
    await expect(toggle).toHaveAttribute("aria-busy", "true");
  },
};

export const SaysWhyTurningOffFailed: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.put(
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
    await expect(toggle).toBeChecked();
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
      http.put(
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
