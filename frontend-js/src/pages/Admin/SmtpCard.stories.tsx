import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import {
  anUnconfiguredSmtp,
  aWireSmtpStatus,
  type SmtpWrites,
  smtpHandlers,
} from "../../testing/adminHandlers";
import { deferred, failing, hanging } from "../../testing/handlers";
import { SmtpCard } from "./SmtpCard";

const SMTP = "/api/smtp";

const writes: SmtpWrites = { saved: [], actions: [] };

const meta = {
  title: "Pages/Admin/SmtpCard",
  component: SmtpCard,
  beforeEach({ msw }) {
    writes.saved.length = 0;
    writes.actions.length = 0;
    msw.use(...smtpHandlers(aWireSmtpStatus(), writes));
  },
} satisfies Meta<typeof SmtpCard>;

export default meta;
type Story = StoryObj<typeof meta>;

const SAVE = "Save SMTP settings";

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging(SMTP));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", {
        level: 3,
        name: "Email delivery (SMTP)",
      }),
    ).toBeInTheDocument();
    const status = canvas.getByTestId("smtp-status");
    await expect(status).toHaveTextContent("Checking…");
    await expect(status.querySelector(".api-key-dot")).toHaveClass("pending");
    await expect(canvas.getByText("Checking…")).toHaveClass("ld-sheen");
    await expect(canvas.getByRole("button", { name: SAVE })).toBeDisabled();
    await expect(canvas.queryByTestId("smtp-clear")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("smtp-test")).not.toBeInTheDocument();
  },
};

export const LoadFailed: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", SMTP, 500));
  },
  play: async ({ canvas }) => {
    const message = await canvas.findByText(
      "Couldn’t read the current settings: failed with 500",
    );
    await expect(message).toHaveClass("settings-status", "error");
    await expect(canvas.getByTestId("smtp-status")).toHaveTextContent(
      "Status unavailable",
    );
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: SAVE })).toBeDisabled();
  },
};

export const TryAgainReadsTheRelayAgain: Story = {
  beforeEach({ msw }) {
    let reads = 0;
    msw.use(
      http.get(SMTP, () =>
        ++reads === 1
          ? new HttpResponse("failed with 500", { status: 500 })
          : HttpResponse.json(aWireSmtpStatus()),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Try again" }),
    );

    await waitFor(() =>
      expect(canvas.getByTestId("smtp-status")).toHaveTextContent(
        "Configured · settings",
      ),
    );
    await expect(canvas.getByLabelText("SMTP host")).toHaveValue(
      "smtp.example.com",
    );
    await expect(
      canvas.queryByText(/Couldn’t read the current settings/),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: SAVE })).toBeEnabled();
  },
};

export const ShowsAConfiguredRelay: Story = {
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(canvas.getByLabelText("SMTP host")).toHaveValue(
        "smtp.example.com",
      ),
    );
    await expect(canvas.getByLabelText("Port")).toHaveValue(465);
    await expect(canvas.getByLabelText("Security")).toHaveValue("tls");
    await expect(canvas.getByLabelText("Username")).toHaveValue("mailer");
    await expect(canvas.getByLabelText("From address")).toHaveValue(
      "library@example.com",
    );
    const password = canvas.getByLabelText("Password");
    await expect(password).toHaveValue("");
    await expect(password).toHaveAttribute("placeholder", "•••• (unchanged)");
    const status = canvas.getByTestId("smtp-status");
    await expect(status).toHaveTextContent("Configured · settings");
    await expect(status.querySelector(".api-key-dot")).toHaveClass("connected");
    await expect(canvas.getByRole("button", { name: "Clear…" })).toBeEnabled();
    await expect(
      canvas.getByRole("button", { name: "Send test email" }),
    ).toBeEnabled();
    await expect(canvas.getByRole("button", { name: SAVE })).toBeEnabled();
    await expect(
      canvas.getByTestId("smtp-card").querySelector("form"),
    ).toHaveAttribute("novalidate");
  },
};

export const ShowsAnUnconfiguredRelay: Story = {
  beforeEach({ msw }) {
    msw.use(...smtpHandlers(anUnconfiguredSmtp(), writes));
  },
  play: async ({ canvas }) => {
    await waitFor(() =>
      expect(canvas.getByTestId("smtp-status")).toHaveTextContent(
        "Not configured",
      ),
    );
    await expect(canvas.getByLabelText("SMTP host")).toHaveValue("");
    await expect(canvas.getByLabelText("Port")).toHaveValue(587);
    await expect(canvas.getByLabelText("Security")).toHaveValue("starttls");
    await expect(canvas.getByLabelText("Password")).toHaveAttribute(
      "placeholder",
      "",
    );
    await expect(
      canvas.getByTestId("smtp-status").querySelector(".api-key-dot"),
    ).not.toHaveClass("connected", "pending");
    await expect(canvas.queryByTestId("smtp-clear")).not.toBeInTheDocument();
    await expect(canvas.queryByTestId("smtp-test")).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: SAVE })).toBeEnabled();
  },
};

export const SavesWithoutAPasswordWhenItIsBlank: Story = {
  play: async ({ canvas, userEvent }) => {
    const host = canvas.getByLabelText("SMTP host");
    await waitFor(() => expect(host).toHaveValue("smtp.example.com"));
    await userEvent.clear(host);
    await userEvent.type(host, " smtp.other.test ");
    await userEvent.click(canvas.getByRole("button", { name: SAVE }));

    const message = await canvas.findByText("SMTP settings saved.");
    await expect(message).toHaveClass("settings-status", "success");
    await expect(writes.saved).toEqual([
      {
        host: "smtp.other.test",
        port: 465,
        username: "mailer",
        from_email: "library@example.com",
        security: "tls",
      },
    ]);
    await expect(host).toHaveValue(" smtp.other.test ");
  },
};

export const SavesATypedPasswordAndClearsTheField: Story = {
  play: async ({ canvas, userEvent }) => {
    const password = canvas.getByLabelText("Password");
    await waitFor(() =>
      expect(canvas.getByLabelText("SMTP host")).toHaveValue(
        "smtp.example.com",
      ),
    );
    await userEvent.type(password, "relay secret");
    await userEvent.selectOptions(
      canvas.getByLabelText("Security"),
      "starttls",
    );
    await userEvent.click(canvas.getByRole("button", { name: SAVE }));

    await canvas.findByText("SMTP settings saved.");
    await expect(writes.saved).toMatchObject([
      { password: "relay secret", security: "starttls" },
    ]);
    await waitFor(() => expect(password).toHaveValue(""));
  },
};

let saveGate = deferred();

export const KeepsAPasswordTypedWhileTheSaveIsOut: Story = {
  beforeEach({ msw }) {
    saveGate = deferred();
    msw.use(
      http.post(SMTP, async () => {
        await saveGate.promise;
        return HttpResponse.json(aWireSmtpStatus());
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const password = canvas.getByLabelText("Password");
    await waitFor(() =>
      expect(canvas.getByLabelText("SMTP host")).toHaveValue(
        "smtp.example.com",
      ),
    );
    await userEvent.type(password, "abc");
    await userEvent.click(canvas.getByRole("button", { name: SAVE }));
    await userEvent.type(password, "d");

    saveGate.release();

    await canvas.findByText("SMTP settings saved.");
    await expect(password).toHaveValue("abcd");
  },
};

export const RefusesAPortOutsideTheRange: Story = {
  play: async ({ canvas, userEvent }) => {
    const port = canvas.getByLabelText("Port");
    await waitFor(() => expect(port).toHaveValue(465));
    await userEvent.clear(port);
    await userEvent.type(port, "0");
    await userEvent.click(canvas.getByRole("button", { name: SAVE }));

    await expect(
      await canvas.findByText("Port must be a number between 1 and 65535."),
    ).toHaveClass("settings-status", "error");
    await expect(writes.saved).toEqual([]);
  },
};

export const ShowsASaveRefusal: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(
        SMTP,
        () => new HttpResponse("the host must not be empty", { status: 422 }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await waitFor(() =>
      expect(canvas.getByLabelText("SMTP host")).toHaveValue(
        "smtp.example.com",
      ),
    );
    await userEvent.click(canvas.getByRole("button", { name: SAVE }));

    await expect(
      await canvas.findByText(
        "Couldn’t save the SMTP settings: the host must not be empty",
      ),
    ).toHaveClass("settings-status", "error");
    await expect(canvas.getByRole("button", { name: SAVE })).toBeEnabled();
  },
};

export const HoldsTheActionsWhileSaving: Story = {
  beforeEach({ msw }) {
    saveGate = deferred();
    msw.use(
      http.post(SMTP, async () => {
        await saveGate.promise;
        return HttpResponse.json(aWireSmtpStatus());
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await waitFor(() =>
      expect(canvas.getByLabelText("SMTP host")).toHaveValue(
        "smtp.example.com",
      ),
    );
    const save = canvas.getByRole("button", { name: SAVE });
    await userEvent.click(save);

    await waitFor(() => expect(save).toHaveTextContent("Saving…"));
    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute("aria-busy", "true");
    await expect(canvas.getByTestId("smtp-clear")).toBeDisabled();
    await expect(canvas.getByTestId("smtp-test")).toBeDisabled();
    saveGate.release();
    await waitFor(() => expect(save).toBeEnabled());
  },
};

export const ClearsTheRelayAfterConfirming: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Clear…" }),
    );

    const dialog = await canvas.findByTestId("smtp-clear-dialog");
    await expect(
      within(dialog).getByRole("heading", {
        name: "Clear the SMTP settings?",
      }),
    ).toBeInTheDocument();
    await expect(
      within(dialog).getByText(
        "This removes the relay host, sign-in and stored password. Send-to-Kindle stops working until the relay is set up again.",
      ),
    ).toBeInTheDocument();
    await expect(writes.actions).toEqual([]);
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Clear SMTP settings" }),
    );

    await expect(await canvas.findByText("SMTP settings cleared.")).toHaveClass(
      "settings-status",
      "success",
    );
    await expect(writes.actions).toEqual(["clear"]);
    await expect(
      canvas.queryByTestId("smtp-clear-dialog"),
    ).not.toBeInTheDocument();
    await expect(canvas.getByLabelText("SMTP host")).toHaveValue("");
    await expect(canvas.getByLabelText("Port")).toHaveValue(587);
    await expect(canvas.getByLabelText("Security")).toHaveValue("starttls");
    await expect(canvas.getByLabelText("Username")).toHaveValue("");
    await expect(canvas.getByLabelText("From address")).toHaveValue("");
    await expect(canvas.getByTestId("smtp-status")).toHaveTextContent(
      "Not configured",
    );
    await expect(canvas.queryByTestId("smtp-clear")).not.toBeInTheDocument();
  },
};

export const CancellingTheClearKeepsTheRelay: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Clear…" }),
    );
    const dialog = await canvas.findByTestId("smtp-clear-dialog");

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" }),
    );

    await expect(
      canvas.queryByTestId("smtp-clear-dialog"),
    ).not.toBeInTheDocument();
    await expect(writes.actions).toEqual([]);
    await expect(canvas.getByTestId("smtp-status")).toHaveTextContent(
      "Configured · settings",
    );
  },
};

export const ShowsAClearRefusalAndClosesTheDialog: Story = {
  beforeEach({ msw }) {
    msw.use(failing("post", "/api/smtp/clear", 500));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Clear…" }),
    );
    const dialog = await canvas.findByTestId("smtp-clear-dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Clear SMTP settings" }),
    );

    await expect(
      await canvas.findByText(
        "Couldn’t clear the SMTP settings: failed with 500",
      ),
    ).toHaveClass("settings-status", "error");
    await expect(
      canvas.queryByTestId("smtp-clear-dialog"),
    ).not.toBeInTheDocument();
    await expect(canvas.getByLabelText("SMTP host")).toHaveValue(
      "smtp.example.com",
    );
  },
};

export const SendsATestEmail: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Send test email" }),
    );

    await expect(
      await canvas.findByText("Test email sent to your Kindle address."),
    ).toHaveClass("settings-status", "success");
    await expect(writes.actions).toEqual(["test"]);
  },
};

export const ShowsATestFailure: Story = {
  beforeEach({ msw }) {
    msw.use(failing("post", "/api/smtp/test", 502));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Send test email" }),
    );

    await expect(
      await canvas.findByText(
        "Test email failed — check the SMTP settings and your account's Kindle email.",
      ),
    ).toHaveClass("settings-status", "error");
  },
};
