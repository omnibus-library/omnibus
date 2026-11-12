import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, fn, waitFor, within } from "storybook/test";
import {
  aWireNotificationConnection,
  type NotificationWrites,
  notificationHandlers,
} from "../../testing/adminHandlers";
import { deferred } from "../../testing/handlers";
import { NotificationConnectionModal } from "./NotificationConnectionModal";

const LIST = "/api/admin/notifications/connections";
const TEST = "/api/admin/notifications/test";

const writes: NotificationWrites = {
  created: [],
  updated: [],
  switched: [],
  deleted: [],
  tested: [],
};

/** The connection the edit stories open: ntfy.sh with a saved token. */
const PHONE = aWireNotificationConnection(
  { id: 7, name: "Phone", last_delivery: null },
  { priority: 4, tags: ["books"], include_details: false },
);

const meta = {
  title: "Pages/Admin/NotificationConnectionModal",
  component: NotificationConnectionModal,
  args: {
    editing: null,
    available: ["request_needs_chooser"],
    onClose: fn(),
    onSaved: fn(),
    onGone: fn(),
  },
  beforeEach({ msw }) {
    for (const list of Object.values(writes)) list.length = 0;
    msw.use(...notificationHandlers([PHONE], { writes }));
  },
} satisfies Meta<typeof NotificationConnectionModal>;

export default meta;
type Story = StoryObj<typeof meta>;

const SAVE = "Save connection";
const TEST_BUTTON = "Send test";

const dialogOf = (canvas: ReturnType<typeof within>, name: string) =>
  canvas.findByRole("dialog", { name });

/** Fills what every connection needs: a name, a server and a topic. */
async function fillBasics(
  dialog: HTMLElement,
  userEvent: { type: (el: Element, text: string) => Promise<void> },
) {
  const scope = within(dialog);
  await userEvent.type(scope.getByLabelText("Name"), "Kitchen tablet");
  await userEvent.type(scope.getByLabelText("Server URL"), "https://ntfy.sh");
  await userEvent.type(scope.getByLabelText("Topic"), "omnibus-kitchen");
}

export const AddsAConnection: Story = {
  play: async ({ args, canvas, userEvent }) => {
    const dialog = await dialogOf(canvas, "New ntfy connection");
    const scope = within(dialog);
    await expect(scope.getByLabelText("Server URL")).toHaveAttribute(
      "placeholder",
      "https://ntfy.sh",
    );
    await fillBasics(dialog, userEvent);
    await userEvent.selectOptions(scope.getByLabelText("Sign-in"), "token");
    await userEvent.type(scope.getByLabelText("Access token"), "tk_kitchen");
    await userEvent.selectOptions(scope.getByLabelText("Priority"), "4");
    await userEvent.type(
      scope.getByLabelText("Tags (optional)"),
      "books, ,bell",
    );
    const details = scope.getByRole("switch", {
      name: "Include book and requester details",
    });
    await expect(details).toBeChecked();
    await expect(details).toHaveAccessibleDescription(
      "Turned off, the message leaves out the book’s title and who asked, for a topic other people can read.",
    );
    await userEvent.click(details);
    await expect(
      scope.getByRole("checkbox", { name: "A request needs a version picked" }),
    ).toBeChecked();
    await userEvent.click(scope.getByRole("button", { name: SAVE }));

    await waitFor(() => expect(args.onSaved).toHaveBeenCalledOnce());
    await expect(writes.created).toEqual([
      {
        name: "Kitchen tablet",
        enabled: true,
        events: ["request_needs_chooser"],
        settings: {
          kind: "ntfy",
          server_url: "https://ntfy.sh",
          topic: "omnibus-kitchen",
          auth: "token",
          token: "tk_kitchen",
          priority: 4,
          tags: ["books", "bell"],
          include_details: false,
        },
      },
    ]);
    await expect(args.onSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Kitchen tablet",
        settings: expect.objectContaining({ token_set: true }),
      }),
    );
  },
};

export const SaysWhatIsMissing: Story = {
  play: async ({ canvas, userEvent }) => {
    const dialog = await dialogOf(canvas, "New ntfy connection");
    const scope = within(dialog);
    await userEvent.selectOptions(scope.getByLabelText("Sign-in"), "token");
    await userEvent.click(scope.getByRole("button", { name: SAVE }));

    for (const [label, message] of [
      ["Name", "Give the connection a name."],
      ["Server URL", "Enter the ntfy server’s address."],
      ["Topic", "Enter a topic."],
      ["Access token", "Enter the access token."],
    ] as const) {
      const field = scope.getByLabelText(label);
      await waitFor(() =>
        expect(field).toHaveAttribute("aria-invalid", "true"),
      );
      await expect(field).toHaveAccessibleDescription(
        new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }
    await expect(writes.created).toEqual([]);
  },
};

export const EditingKeepsTheSavedToken: Story = {
  args: { editing: PHONE },
  play: async ({ args, canvas, canvasElement, userEvent }) => {
    const dialog = await dialogOf(canvas, "Edit Phone");
    const scope = within(dialog);
    await expect(scope.getByLabelText("Name")).toHaveValue("Phone");
    await expect(scope.getByLabelText("Sign-in")).toHaveValue("token");
    await expect(scope.getByLabelText("Priority")).toHaveValue("4");
    await expect(scope.getByLabelText("Tags (optional)")).toHaveValue("books");
    const token = scope.getByLabelText("Access token");
    // The saved token is shown as set, never as its value.
    await expect(token).toHaveValue("");
    await expect(token).toHaveAttribute("type", "password");
    await expect(token).toHaveAttribute(
      "placeholder",
      "Leave blank to keep the saved token",
    );
    await expect(scope.getByTestId("notify-token-status")).toHaveTextContent(
      "A token is saved",
    );
    const values = [...canvasElement.querySelectorAll("input")].map(
      (input) => input.value,
    );
    await expect(values.filter((value) => value.startsWith("tk_"))).toEqual([]);

    await userEvent.clear(scope.getByLabelText("Name"));
    await userEvent.type(scope.getByLabelText("Name"), "My phone");
    await userEvent.click(scope.getByRole("button", { name: SAVE }));

    await waitFor(() => expect(args.onSaved).toHaveBeenCalledOnce());
    await expect(writes.updated).toHaveLength(1);
    const { id, body } = writes.updated[0] ?? {};
    await expect(id).toBe(7);
    await expect(body).toEqual({
      name: "My phone",
      enabled: true,
      events: ["request_needs_chooser"],
      settings: {
        kind: "ntfy",
        server_url: "https://ntfy.sh",
        topic: "omnibus-requests",
        auth: "token",
        priority: 4,
        tags: ["books"],
        include_details: false,
      },
    });
    await expect(body).not.toHaveProperty("settings.token");
    await expect(args.onSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ token_set: true }),
      }),
    );
  },
};

export const ReplacesTheSavedToken: Story = {
  args: { editing: PHONE },
  play: async ({ args, canvas, userEvent }) => {
    const dialog = await dialogOf(canvas, "Edit Phone");
    const scope = within(dialog);
    await userEvent.type(scope.getByLabelText("Access token"), "tk_new");
    await userEvent.click(scope.getByRole("button", { name: SAVE }));

    await waitFor(() => expect(args.onSaved).toHaveBeenCalledOnce());
    await expect(writes.updated[0]).toMatchObject({
      body: { settings: { auth: "token", token: "tk_new" } },
    });
  },
};

export const SwitchingToAPasswordAsksForOne: Story = {
  args: { editing: PHONE },
  play: async ({ args, canvas, userEvent }) => {
    const dialog = await dialogOf(canvas, "Edit Phone");
    const scope = within(dialog);
    await userEvent.selectOptions(scope.getByLabelText("Sign-in"), "basic");
    await expect(
      scope.queryByLabelText("Access token"),
    ).not.toBeInTheDocument();
    const password = scope.getByLabelText("Password");
    // The saved token doesn't carry over to the new mode.
    await expect(password).toHaveAttribute("placeholder", "");
    await userEvent.type(scope.getByLabelText("Username"), "ada");
    await userEvent.click(scope.getByRole("button", { name: SAVE }));

    await waitFor(() =>
      expect(password).toHaveAccessibleDescription("Enter the password."),
    );
    await expect(writes.updated).toEqual([]);

    await userEvent.type(password, "s3cret");
    await userEvent.click(scope.getByRole("button", { name: SAVE }));

    await waitFor(() => expect(args.onSaved).toHaveBeenCalledOnce());
    await expect(writes.updated[0]).toMatchObject({
      body: {
        settings: { auth: "basic", username: "ada", password: "s3cret" },
      },
    });
    await expect(writes.updated[0]).not.toHaveProperty("body.settings.token");
  },
};

export const ChangingTheServerAsksForTheTokenAgain: Story = {
  args: { editing: PHONE },
  play: async ({ args, canvas, userEvent }) => {
    const dialog = await dialogOf(canvas, "Edit Phone");
    const scope = within(dialog);
    const server = scope.getByLabelText("Server URL");
    const token = scope.getByLabelText("Access token");
    await expect(scope.getByTestId("notify-token-status")).toHaveTextContent(
      "A token is saved",
    );

    await userEvent.clear(server);
    await userEvent.type(server, "https://ntfy.example.com");
    // The saved token only goes to the address it was saved for.
    await expect(
      scope.queryByTestId("notify-token-status"),
    ).not.toBeInTheDocument();
    await expect(token).not.toHaveAttribute(
      "placeholder",
      "Leave blank to keep the saved token",
    );
    await expect(token).toHaveAccessibleDescription(
      "The server URL changed, so enter the token again.",
    );

    await userEvent.click(scope.getByRole("button", { name: SAVE }));
    await waitFor(() => expect(token).toHaveAttribute("aria-invalid", "true"));
    await expect(token).toHaveAccessibleDescription(
      "The server URL changed, so enter the token again.",
    );
    await userEvent.click(scope.getByRole("button", { name: TEST_BUTTON }));
    await waitFor(() =>
      expect(scope.getByTestId("notify-test-status")).toHaveTextContent(
        "Fix the fields above before sending a test.",
      ),
    );
    await expect(writes.updated).toEqual([]);
    await expect(writes.tested).toEqual([]);
    await expect(args.onSaved).not.toHaveBeenCalled();

    // Back at the saved address, a blank field keeps the token again.
    await userEvent.clear(server);
    await userEvent.type(server, "https://ntfy.sh");
    await waitFor(() => expect(token).toHaveAttribute("aria-invalid", "false"));
    await expect(scope.getByTestId("notify-token-status")).toHaveTextContent(
      "A token is saved",
    );
    await userEvent.click(scope.getByRole("button", { name: SAVE }));
    await waitFor(() => expect(args.onSaved).toHaveBeenCalledOnce());
    await expect(writes.updated[0]?.body).not.toHaveProperty("settings.token");
  },
};

export const ChangingTheUsernameAsksForThePasswordAgain: Story = {
  args: {
    editing: aWireNotificationConnection(
      { id: 8, name: "Laptop" },
      { auth: "basic", username: "ada", token_set: false, password_set: true },
    ),
  },
  play: async ({ canvas, userEvent }) => {
    const dialog = await dialogOf(canvas, "Edit Laptop");
    const scope = within(dialog);
    const password = scope.getByLabelText("Password");
    await expect(scope.getByTestId("notify-password-status")).toBeVisible();
    await userEvent.type(scope.getByLabelText("Username"), "x");

    await expect(
      scope.queryByTestId("notify-password-status"),
    ).not.toBeInTheDocument();
    await expect(password).toHaveAccessibleDescription(
      "The username changed, so enter the password again.",
    );
  },
};

export const SendingATestWithAMissingFieldSaysWhy: Story = {
  play: async ({ canvas, userEvent }) => {
    const dialog = await dialogOf(canvas, "New ntfy connection");
    const scope = within(dialog);
    await userEvent.type(scope.getByLabelText("Server URL"), "https://ntfy.sh");
    await userEvent.click(scope.getByRole("button", { name: TEST_BUTTON }));

    const topic = scope.getByLabelText("Topic");
    await waitFor(() => expect(topic).toHaveFocus());
    await expect(topic).toHaveAttribute("aria-invalid", "true");
    const status = scope.getByTestId("notify-test-status");
    await expect(status).toHaveAttribute("role", "status");
    await expect(status).toHaveTextContent(
      "Fix the fields above before sending a test.",
    );
    await expect(status).toHaveClass("error");
    // The name isn't a reason to refuse a test.
    await expect(scope.getByLabelText("Name")).toHaveAttribute(
      "aria-invalid",
      "false",
    );
    await expect(writes.tested).toEqual([]);

    // Fixing the field clears its refusal and the message, as after a save.
    await userEvent.type(topic, "omnibus-kitchen");
    await waitFor(() => expect(topic).toHaveAttribute("aria-invalid", "false"));
    await expect(status).toBeEmptyDOMElement();
  },
};

export const AResultGoesWhenTheFormChanges: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(
        LIST,
        () =>
          new HttpResponse("a tag can be at most 64 characters", {
            status: 422,
          }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const dialog = await dialogOf(canvas, "New ntfy connection");
    const scope = within(dialog);
    await fillBasics(dialog, userEvent);
    const status = scope.getByTestId("notify-test-status");
    await userEvent.click(scope.getByRole("button", { name: TEST_BUTTON }));
    await waitFor(() =>
      expect(status).toHaveTextContent("Test notification sent."),
    );

    await userEvent.type(scope.getByLabelText("Topic"), "-2");
    await expect(status).toBeEmptyDOMElement();

    await userEvent.click(scope.getByRole("button", { name: SAVE }));
    await expect(await scope.findByRole("alert")).toHaveTextContent(
      "Couldn’t save the connection: a tag can be at most 64 characters",
    );
    await userEvent.type(scope.getByLabelText("Tags (optional)"), "books");
    await expect(scope.queryByRole("alert")).not.toBeInTheDocument();
  },
};

export const ASaveInFlightCanNotBeCancelled: Story = {
  beforeEach({ msw }) {
    const gate = deferred();
    msw.use(
      http.post(LIST, async () => {
        await gate.promise;
        return new HttpResponse(null, { status: 500 });
      }),
    );
  },
  play: async ({ args, canvas, userEvent }) => {
    const dialog = await dialogOf(canvas, "New ntfy connection");
    const scope = within(dialog);
    await fillBasics(dialog, userEvent);
    await userEvent.click(scope.getByRole("button", { name: SAVE }));

    // While it works the button reads "Saving…".
    await waitFor(() =>
      expect(scope.getByTestId("notify-save")).toHaveAttribute(
        "aria-busy",
        "true",
      ),
    );
    await expect(scope.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await expect(scope.getByRole("button", { name: "Close" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await expect(dialog).toBeInTheDocument();
    await expect(args.onClose).not.toHaveBeenCalled();
  },
};

export const TestInFlight: Story = {
  beforeEach({ msw }) {
    const gate = deferred();
    msw.use(
      http.post(TEST, async () => {
        await gate.promise;
        return new HttpResponse(null, { status: 204 });
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const dialog = await dialogOf(canvas, "New ntfy connection");
    const scope = within(dialog);
    await fillBasics(dialog, userEvent);
    const test = scope.getByRole("button", { name: TEST_BUTTON });
    await userEvent.click(test);

    await waitFor(() => expect(test).toHaveAttribute("aria-busy", "true"));
    await expect(test).toBeDisabled();
    await expect(test).toHaveTextContent("Sending…");
    await expect(scope.getByTestId("notify-test-status")).toHaveTextContent(
      "Sending a test notification…",
    );
    // The form stays readable and editable while the test is out.
    await expect(scope.getByLabelText("Topic")).toBeEnabled();
    await expect(scope.getByLabelText("Topic")).toHaveValue("omnibus-kitchen");
  },
};

export const TestSucceeded: Story = {
  play: async ({ canvas, userEvent }) => {
    const dialog = await dialogOf(canvas, "New ntfy connection");
    const scope = within(dialog);
    // A test needs no name.
    await userEvent.type(scope.getByLabelText("Server URL"), "https://ntfy.sh");
    await userEvent.type(scope.getByLabelText("Topic"), "omnibus-kitchen");
    await userEvent.click(scope.getByRole("button", { name: TEST_BUTTON }));

    const status = scope.getByTestId("notify-test-status");
    await waitFor(() =>
      expect(status).toHaveTextContent("Test notification sent."),
    );
    await expect(status).toHaveClass("success");
    await expect(writes.tested).toEqual([
      {
        settings: {
          kind: "ntfy",
          server_url: "https://ntfy.sh",
          topic: "omnibus-kitchen",
          auth: "none",
          priority: 3,
          tags: [],
          include_details: true,
        },
      },
    ]);
    // A test saves nothing.
    await expect(writes.created).toEqual([]);
  },
};

export const TestFailedShowsTheServersSentence: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(
        TEST,
        () =>
          new HttpResponse(
            "ntfy refused the sign-in. Check the access token, or the username and password.",
            { status: 502 },
          ),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const dialog = await dialogOf(canvas, "New ntfy connection");
    const scope = within(dialog);
    await fillBasics(dialog, userEvent);
    await userEvent.click(scope.getByRole("button", { name: TEST_BUTTON }));

    const status = scope.getByTestId("notify-test-status");
    await waitFor(() =>
      expect(status).toHaveTextContent(
        "Test failed: ntfy refused the sign-in. Check the access token, or the username and password.",
      ),
    );
    await expect(status).toHaveClass("error");
    await expect(
      scope.getByRole("button", { name: TEST_BUTTON }),
    ).toBeEnabled();
  },
};

export const TestRefusedSaysWhy: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(
        TEST,
        () => new HttpResponse("at most 10 tags are allowed", { status: 422 }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const dialog = await dialogOf(canvas, "New ntfy connection");
    const scope = within(dialog);
    await fillBasics(dialog, userEvent);
    await userEvent.click(scope.getByRole("button", { name: TEST_BUTTON }));

    await waitFor(() =>
      expect(scope.getByTestId("notify-test-status")).toHaveTextContent(
        "Test failed: at most 10 tags are allowed",
      ),
    );
  },
};

export const TestingAnEditUsesTheSavedToken: Story = {
  args: { editing: PHONE },
  play: async ({ canvas, userEvent }) => {
    const dialog = await dialogOf(canvas, "Edit Phone");
    const scope = within(dialog);
    await userEvent.click(scope.getByRole("button", { name: TEST_BUTTON }));

    await waitFor(() => expect(writes.tested).toHaveLength(1));
    await expect(writes.tested[0]).toMatchObject({
      id: 7,
      settings: { auth: "token" },
    });
    await expect(writes.tested[0]).not.toHaveProperty("settings.token");
  },
};

export const SaveRefusedSaysWhy: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(
        LIST,
        () =>
          new HttpResponse("a tag can be at most 64 characters", {
            status: 422,
          }),
      ),
    );
  },
  play: async ({ args, canvas, userEvent }) => {
    const dialog = await dialogOf(canvas, "New ntfy connection");
    const scope = within(dialog);
    await fillBasics(dialog, userEvent);
    await userEvent.click(scope.getByRole("button", { name: SAVE }));

    await expect(await scope.findByRole("alert")).toHaveTextContent(
      "Couldn’t save the connection: a tag can be at most 64 characters",
    );
    await expect(args.onSaved).not.toHaveBeenCalled();
    await expect(scope.getByLabelText("Name")).toHaveValue("Kitchen tablet");
  },
};

export const SaysWhenNoEventIsOffered: Story = {
  args: { available: [] },
  play: async ({ canvas }) => {
    const dialog = await dialogOf(canvas, "New ntfy connection");
    await expect(
      within(dialog).getByTestId("notify-events-none"),
    ).toHaveTextContent(
      "Request events are available when book requests are turned on.",
    );
    await expect(
      within(dialog).queryByRole("checkbox"),
    ).not.toBeInTheDocument();
  },
};

export const KeepsAnEventTheServerDoesNotOffer: Story = {
  args: { editing: PHONE, available: [] },
  play: async ({ args, canvas, userEvent }) => {
    const dialog = await dialogOf(canvas, "Edit Phone");
    const scope = within(dialog);
    const event = scope.getByRole("checkbox", {
      name: "A request needs a version picked",
    });
    await expect(event).toBeChecked();
    await expect(event).toHaveAccessibleDescription(
      "Not sent while book requests are off. It stays chosen for when they’re back on.",
    );
    await userEvent.click(scope.getByRole("button", { name: SAVE }));

    await waitFor(() => expect(args.onSaved).toHaveBeenCalledOnce());
    await expect(writes.updated[0]).toMatchObject({
      body: { events: ["request_needs_chooser"] },
    });
  },
};

export const SaysWhenTheConnectionIsGone: Story = {
  args: { editing: { ...PHONE, id: 99 } },
  play: async ({ args, canvas, userEvent }) => {
    const dialog = await dialogOf(canvas, "Edit Phone");
    await userEvent.click(within(dialog).getByRole("button", { name: SAVE }));

    await waitFor(() => expect(args.onGone).toHaveBeenCalledOnce());
    await expect(args.onSaved).not.toHaveBeenCalled();
  },
};
