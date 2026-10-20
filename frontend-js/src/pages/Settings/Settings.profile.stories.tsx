import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor } from "storybook/test";
import { failing } from "../../testing/handlers";
import { SettingsRoutes, said } from "../../testing/SettingsRoutes";
import {
  aSettingsServer,
  settingsHandlers,
} from "../../testing/settingsHandlers";
import { WIRE_ADA } from "../../testing/wire";

const WITH_PHOTO = { ...WIRE_ADA, has_avatar: true };

const meta = {
  title: "Pages/Settings/Profile",
  component: SettingsRoutes,
  args: { path: "/settings?section=profile" },
  parameters: { ownRouter: true },
  beforeEach({ msw }) {
    msw.use(...settingsHandlers(aSettingsServer()));
  },
} satisfies Meta<typeof SettingsRoutes>;

export default meta;
type Story = StoryObj<typeof meta>;

const png = () => new File(["x"], "me.png", { type: "image/png" });

export const ShowsTheSavedName: Story = {
  play: async ({ canvas }) => {
    const card = await canvas.findByTestId("account-profile-card");
    await expect(canvas.getByLabelText("Display name")).toHaveValue(
      "Ada Lovelace",
    );
    await expect(canvas.getByTestId("display-name-save")).toBeDisabled();
    await expect(canvas.queryByTestId("avatar-remove")).not.toBeInTheDocument();
    await expect(card).toHaveTextContent(
      "JPEG, PNG, WebP or GIF, up to 10 MB.",
    );
  },
};

export const SavesANewName: Story = {
  play: async ({ canvas, userEvent }) => {
    const input = await canvas.findByLabelText("Display name");
    await userEvent.clear(input);
    await userEvent.type(input, "Ada King");
    await userEvent.click(canvas.getByTestId("display-name-save"));

    await waitFor(() =>
      expect(canvas.getByTestId("profile-status")).toHaveTextContent(
        "Profile saved.",
      ),
    );
    await expect(input).toHaveValue("Ada King");
    await waitFor(() =>
      expect(canvas.getByTestId("display-name-save")).toBeDisabled(),
    );
  },
};

export const ClearsTheNameToTheUsername: Story = {
  play: async ({ canvas, userEvent }) => {
    const input = await canvas.findByLabelText("Display name");
    await userEvent.clear(input);
    await userEvent.click(canvas.getByTestId("display-name-save"));

    await waitFor(() =>
      expect(canvas.getByTestId("profile-status")).toHaveTextContent(
        "Profile saved.",
      ),
    );
    await waitFor(() => expect(input).toHaveAttribute("placeholder", "ada"));
  },
};

export const RefusesAName: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(
        "/api/account/profile",
        () => new HttpResponse("display name is too long", { status: 422 }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const input = await canvas.findByLabelText("Display name");
    await userEvent.type(input, "!");
    await userEvent.click(canvas.getByTestId("display-name-save"));

    const status = await canvas.findByTestId("profile-status");
    await waitFor(() =>
      expect(status).toHaveTextContent("display name is too long"),
    );
    await expect(status).toHaveClass("error");
    await expect(input).toHaveValue("Ada Lovelace!");
  },
};

export const AsksBeforeLeavingAnEditedName: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByLabelText("Display name"), "!");
    await userEvent.click(canvas.getByTestId("settings-nav-goals"));

    await expect(await canvas.findByTestId("unsaved-confirm")).toBeVisible();
  },
};

export const UploadsAPicture: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(
      await canvas.findByTestId("avatar-file-input"),
      png(),
    );

    await waitFor(() =>
      expect(canvas.getByTestId("profile-status")).toHaveTextContent(
        "Profile picture saved.",
      ),
    );
    await expect(
      await canvas.findByRole("img", { name: "Ada Lovelace" }),
    ).toHaveAttribute("src", "/api/users/1/avatar?v=1");
    await expect(canvas.getByTestId("avatar-remove")).toBeInTheDocument();
  },
};

export const RedrawsAReplacedPicture: Story = {
  parameters: { user: WITH_PHOTO },
  beforeEach({ msw }) {
    msw.use(...settingsHandlers(aSettingsServer({ user: WITH_PHOTO })));
  },
  play: async ({ canvas, userEvent }) => {
    const photo = await canvas.findByRole("img", { name: "Ada Lovelace" });
    await expect(photo).toHaveAttribute("src", "/api/users/1/avatar");
    await userEvent.upload(
      await canvas.findByTestId("avatar-file-input"),
      png(),
    );

    await waitFor(() =>
      expect(canvas.getByRole("img", { name: "Ada Lovelace" })).toHaveAttribute(
        "src",
        "/api/users/1/avatar?v=1",
      ),
    );
  },
};

export const RefusesAPicture: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(
        "/api/account/avatar",
        () => new HttpResponse("that is not an image", { status: 415 }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(
      await canvas.findByTestId("avatar-file-input"),
      png(),
    );

    await waitFor(() =>
      expect(canvas.getByTestId("avatar-status")).toHaveTextContent(
        "Upload failed: that is not an image",
      ),
    );
    await expect(canvas.queryByTestId("avatar-remove")).not.toBeInTheDocument();
  },
};

export const RemovesThePictureOnceConfirmed: Story = {
  parameters: { user: WITH_PHOTO },
  beforeEach({ msw }) {
    msw.use(...settingsHandlers(aSettingsServer({ user: WITH_PHOTO })));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("avatar-remove"));
    await expect(
      await canvas.findByTestId("avatar-remove-dialog"),
    ).toHaveTextContent("Other readers will see your initials instead.");
    await userEvent.click(canvas.getByTestId("avatar-remove-dialog-confirm"));

    await waitFor(() =>
      expect(canvas.getByTestId("profile-status")).toHaveTextContent(
        "Profile picture removed.",
      ),
    );
    await waitFor(() =>
      expect(canvas.queryByTestId("avatar-remove")).not.toBeInTheDocument(),
    );
    await expect(
      canvas.queryByRole("img", { name: "Ada Lovelace" }),
    ).toBeNull();
  },
};

export const ShowsAPictureUploadedAfterRemovingOne: Story = {
  parameters: { user: WITH_PHOTO },
  beforeEach({ msw }) {
    msw.use(...settingsHandlers(aSettingsServer({ user: WITH_PHOTO })));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("avatar-remove"));
    await userEvent.click(
      await canvas.findByTestId("avatar-remove-dialog-confirm"),
    );
    await waitFor(() =>
      expect(canvas.queryByRole("img", { name: "Ada Lovelace" })).toBeNull(),
    );
    await userEvent.upload(
      await canvas.findByTestId("avatar-file-input"),
      png(),
    );

    await expect(
      await canvas.findByRole("img", { name: "Ada Lovelace" }),
    ).toBeVisible();
  },
};

export const KeepsTheSavedNameWhenTheSessionRereadFails: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/auth/me", 500));
  },
  play: async ({ canvas, userEvent }) => {
    const input = await canvas.findByLabelText("Display name");
    await userEvent.clear(input);
    await userEvent.type(input, "Ada King");
    await userEvent.click(canvas.getByTestId("display-name-save"));

    await said(canvas, "profile-status", "Profile saved.");
    // The write was accepted, so the card is settled and leaving asks nothing.
    await expect(canvas.getByTestId("display-name-save")).toBeDisabled();
    await userEvent.click(canvas.getByTestId("settings-nav-goals"));
    await expect(
      await canvas.findByRole("heading", { level: 2, name: "Goals" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("unsaved-confirm")).toBeNull();
  },
};
