import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { aWirePublicUrl, publicUrlHandlers } from "../../testing/adminHandlers";
import { failing, hanging } from "../../testing/handlers";
import { PublicUrlCard } from "./PublicUrlCard";

const PUBLIC_URL = "/api/settings/public-url";
const FIELD = "Public server URL";
const SAVE = "Save public URL";
const ENV_URL = "https://env.example.com";

const saved: (string | null)[] = [];

const meta = {
  title: "Pages/Admin/PublicUrlCard",
  component: PublicUrlCard,
  beforeEach({ msw }) {
    saved.length = 0;
    msw.use(...publicUrlHandlers(aWirePublicUrl(), { saved }));
  },
} satisfies Meta<typeof PublicUrlCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging(PUBLIC_URL));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 3, name: FIELD }),
    ).toBeInTheDocument();
    const field = canvas.getByLabelText(FIELD);
    await expect(field).toBeDisabled();
    await expect(field).toHaveClass("ld-unknown");
    await expect(canvas.getByTestId("public-url-status")).toHaveTextContent(
      "Checking…",
    );
    await expect(canvas.getByRole("button", { name: SAVE })).toBeDisabled();
    await expect(
      canvas.queryByRole("button", { name: "Clear saved URL" }),
    ).not.toBeInTheDocument();
  },
};

export const LoadFailed: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", PUBLIC_URL, 500));
  },
  play: async ({ canvas }) => {
    const message = await canvas.findByText(
      "Couldn’t read the public URL: failed with 500",
    );
    await expect(message).toHaveClass("settings-status", "error");
    await expect(canvas.getByTestId("public-url-status")).toHaveTextContent(
      "Status unavailable",
    );
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: SAVE })).toBeDisabled();
  },
};

export const NotSet: Story = {
  beforeEach({ msw }) {
    msw.use(...publicUrlHandlers({ url: null, source: "none" }, { saved }));
  },
  play: async ({ canvas }) => {
    const status = canvas.getByTestId("public-url-status");
    await waitFor(() => expect(status).toHaveTextContent("Not set"));
    await expect(canvas.getByLabelText(FIELD)).toHaveValue("");
    await expect(canvas.getByLabelText(FIELD)).toBeEnabled();
    await expect(
      canvas.queryByRole("button", { name: "Clear saved URL" }),
    ).not.toBeInTheDocument();
  },
};

export const SavedHere: Story = {
  play: async ({ canvas }) => {
    const field = canvas.getByLabelText(FIELD);
    await waitFor(() => expect(field).toHaveValue("https://books.example.com"));
    const status = canvas.getByTestId("public-url-status");
    await expect(status).toHaveTextContent("Saved here");
    await expect(status.querySelector(".api-key-dot")).toHaveClass("connected");
    await expect(
      canvas.getByRole("button", { name: "Clear saved URL" }),
    ).toBeEnabled();
  },
};

export const FromTheEnvironment: Story = {
  beforeEach({ msw }) {
    msw.use(...publicUrlHandlers({ url: ENV_URL, source: "env" }, { saved }));
  },
  play: async ({ canvas, userEvent }) => {
    const status = canvas.getByTestId("public-url-status");
    await waitFor(() =>
      expect(status).toHaveTextContent(
        "Set by the server’s environment (OMNIBUS_PUBLIC_URL)",
      ),
    );
    const field = canvas.getByLabelText(FIELD);
    await expect(field).toHaveValue("");
    await expect(field).toHaveAccessibleDescription(
      `${ENV_URL} is in effect, from the server’s environment. A URL saved here takes its place.`,
    );
    await expect(
      canvas.queryByRole("button", { name: "Clear saved URL" }),
    ).not.toBeInTheDocument();

    await userEvent.type(field, "https://books.example.com");
    await userEvent.click(canvas.getByRole("button", { name: SAVE }));

    await canvas.findByText("Public URL saved.");
    await expect(saved).toEqual(["https://books.example.com"]);
    await expect(status).toHaveTextContent("Saved here");
    await expect(field).toHaveValue("https://books.example.com");
  },
};

export const SavesTheUrlTheServerKeeps: Story = {
  beforeEach({ msw }) {
    msw.use(...publicUrlHandlers({ url: null, source: "none" }, { saved }));
  },
  play: async ({ canvas, userEvent }) => {
    const field = canvas.getByLabelText(FIELD);
    await waitFor(() => expect(field).toBeEnabled());
    await userEvent.type(field, " https://books.example.com/ ");
    await userEvent.click(canvas.getByRole("button", { name: SAVE }));

    const message = await canvas.findByText("Public URL saved.");
    await expect(message).toHaveClass("settings-status", "success");
    await expect(saved).toEqual(["https://books.example.com/"]);
    // The field shows the address as the server stored it.
    await waitFor(() => expect(field).toHaveValue("https://books.example.com"));
  },
};

export const ShowsWhyAUrlWasRefused: Story = {
  play: async ({ canvas, userEvent }) => {
    const field = canvas.getByLabelText(FIELD);
    await waitFor(() => expect(field).toHaveValue("https://books.example.com"));
    await userEvent.clear(field);
    await userEvent.type(field, "ftp://books.example.com");
    await userEvent.click(canvas.getByRole("button", { name: SAVE }));

    const reason = await canvas.findByRole("alert");
    await expect(reason).toHaveTextContent(
      "The public URL must start with http:// or https://",
    );
    await expect(field).toHaveAttribute("aria-invalid", "true");
    await expect(field.getAttribute("aria-describedby")).toBe(reason.id);
    // The field keeps what was typed, and the saved URL is untouched.
    await expect(field).toHaveValue("ftp://books.example.com");
    await expect(canvas.getByTestId("public-url-status")).toHaveTextContent(
      "Saved here",
    );
    await expect(saved).toEqual(["ftp://books.example.com"]);

    await userEvent.type(field, "x");
    await expect(field).toHaveAttribute("aria-invalid", "false");
    await expect(canvas.queryByRole("alert")).not.toBeInTheDocument();
  },
};

export const AsksForAnAddressBeforeSaving: Story = {
  beforeEach({ msw }) {
    msw.use(...publicUrlHandlers({ url: null, source: "none" }, { saved }));
  },
  play: async ({ canvas, userEvent }) => {
    const save = canvas.getByRole("button", { name: SAVE });
    await waitFor(() => expect(save).toBeEnabled());
    await userEvent.click(save);

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Enter the address to save.",
    );
    await expect(saved).toEqual([]);
  },
};

export const ClearsBackToTheEnvironment: Story = {
  beforeEach({ msw }) {
    msw.use(...publicUrlHandlers(aWirePublicUrl(), { saved, env: ENV_URL }));
  },
  play: async ({ canvas, userEvent }) => {
    const clear = await canvas.findByRole("button", {
      name: "Clear saved URL",
    });
    await userEvent.click(clear);

    await canvas.findByText(
      "Saved URL cleared. The server’s environment value is in effect again.",
    );
    await expect(saved).toEqual([null]);
    await expect(canvas.getByLabelText(FIELD)).toHaveValue("");
    await expect(canvas.getByTestId("public-url-status")).toHaveTextContent(
      "Set by the server’s environment (OMNIBUS_PUBLIC_URL)",
    );
  },
};

export const ClearsToNothing: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Clear saved URL" }),
    );

    await canvas.findByText(
      "Public URL cleared. Notifications send without a link.",
    );
    await expect(saved).toEqual([null]);
    await expect(canvas.getByLabelText(FIELD)).toHaveValue("");
    await expect(canvas.getByTestId("public-url-status")).toHaveTextContent(
      "Not set",
    );
    await expect(
      canvas.queryByRole("button", { name: "Clear saved URL" }),
    ).not.toBeInTheDocument();
  },
};
