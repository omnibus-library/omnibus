import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor } from "storybook/test";
import { nowSecs } from "../../format";
import { hanging } from "../../testing/handlers";
import { SettingsRoutes, said } from "../../testing/SettingsRoutes";
import {
  aSettingsServer,
  type SettingsServer,
  settingsHandlers,
} from "../../testing/settingsHandlers";
import { aWireApiToken, WIRE_ADA } from "../../testing/wire";

let server: SettingsServer;

const meta = {
  title: "Pages/Settings/Tokens",
  component: SettingsRoutes,
  args: { path: "/settings?section=security" },
  parameters: { ownRouter: true },
  beforeEach({ msw }) {
    server = aSettingsServer();
    msw.use(...settingsHandlers(server));
  },
} satisfies Meta<typeof SettingsRoutes>;

export default meta;
type Story = StoryObj<typeof meta>;

const day = 86_400;
const withTokens = () => {
  server.tokens = [
    aWireApiToken({ id: 2, name: "Phone shortcut", suffix: null }),
    aWireApiToken({ id: 1, last_used_at: nowSecs() - day }),
    aWireApiToken({
      id: 3,
      name: "Old script",
      last_used_at: nowSecs() - 45 * day,
    }),
  ];
};

export const CountsTokensBeforeSayingNoneExist: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/auth/api-tokens"));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("api-tokens-count-pending"),
    ).toHaveTextContent("Counting");
    await expect(canvas.queryByTestId("api-tokens-empty")).toBeNull();
    await expect(canvas.queryByTestId("api-tokens-count")).toBeNull();
  },
};

export const GuidesTheFirstToken: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("api-tokens-empty"),
    ).toHaveTextContent("No tokens yet");
    await expect(canvas.getByTestId("api-tokens-count")).toHaveTextContent(
      "0 live tokens",
    );
    await expect(
      canvas.getByRole("button", { name: "Create first token" }),
    ).toBeVisible();
  },
};

export const StatesWhatATokenCarries: Story = {
  parameters: { user: { ...WIRE_ADA, is_admin: false, can_edit: false } },
  play: async ({ canvas }) => {
    const scope = await canvas.findByTestId("api-tokens-scope");
    await expect(scope).toHaveTextContent("Upload");
    await expect(scope).toHaveTextContent("Download");
    await expect(scope).not.toHaveTextContent("Admin");
    await expect(scope).not.toHaveTextContent("Edit");
  },
};

export const ListsTokensWithTheirStatus: Story = {
  beforeEach: withTokens,
  play: async ({ canvas }) => {
    const rows = await canvas.findAllByTestId("api-token-row");
    await expect(rows).toHaveLength(3);
    await expect(canvas.getByTestId("api-tokens-count")).toHaveTextContent(
      "3 live tokens",
    );
    await expect(rows[0]).toHaveTextContent("Phone shortcut");
    await expect(rows[0]).not.toHaveTextContent("omni_…");
    await expect(rows[1]).toHaveTextContent("omni_…k3Zq");
    const pills = canvas.getAllByTestId("api-token-pill");
    await expect(pills.map((p) => p.textContent)).toEqual([
      "Never used",
      "Active",
      "Idle 45d",
    ]);
  },
};

export const CreatesATokenAndHandsOverItsSecretOnce: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByLabelText("Token name"),
      "MCP on my laptop",
    );
    await userEvent.click(canvas.getByTestId("api-token-create"));

    await expect(
      await canvas.findByTestId("api-token-secret"),
    ).toHaveTextContent("omni_secretvalue-Zz9x");
    await expect(canvas.getByTestId("api-token-mcp-command")).toHaveTextContent(
      `claude mcp add --transport http omnibus ${window.location.origin}/mcp --header "Authorization: Bearer omni_secretvalue-Zz9x"`,
    );
    await said(
      canvas,
      "api-tokens-status",
      "Token created. Copy its secret now",
    );
    await expect(await canvas.findAllByTestId("api-token-row")).toHaveLength(1);
    await expect(canvas.queryByTestId("api-tokens-empty")).toBeNull();

    await userEvent.click(canvas.getByTestId("api-token-secret-dismiss"));

    await waitFor(() =>
      expect(canvas.queryByTestId("api-token-secret")).toBeNull(),
    );
    await expect(canvas.queryByText(/omni_secretvalue/)).toBeNull();
  },
};

export const RefusesATokenWithoutAName: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByTestId("api-token-create"));

    await said(canvas, "api-tokens-status", "Enter a name for the token.");
    await expect(server.tokens).toEqual([]);
  },
};

export const RefusesToCreateAToken: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post(
        "/api/auth/api-tokens",
        () => new HttpResponse("too many tokens", { status: 400 }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(await canvas.findByLabelText("Token name"), "Laptop");
    await userEvent.click(canvas.getByTestId("api-token-create"));

    await said(canvas, "api-tokens-status", "too many tokens");
    await expect(canvas.getByTestId("api-tokens-status")).toHaveClass("error");
    await expect(canvas.queryByTestId("api-token-secret")).toBeNull();
    await expect(canvas.getByLabelText("Token name")).toHaveValue("Laptop");
  },
};

export const RenamesATokenInItsRow: Story = {
  beforeEach: withTokens,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Rename Old script" }),
    );
    const input = await canvas.findByLabelText("New token name");
    await expect(input).toHaveValue("Old script");
    await userEvent.clear(input);
    await userEvent.type(input, "Cron job");
    await userEvent.click(canvas.getByTestId("api-token-rename-save"));

    await waitFor(() =>
      expect(canvas.queryByTestId("api-token-rename-row")).toBeNull(),
    );
    await expect(canvas.getByText("Cron job")).toBeVisible();
    await expect(server.tokens.map((t) => t.name)).toContain("Cron job");
  },
};

export const KeepsTheNameWhenRenameIsCancelled: Story = {
  beforeEach: withTokens,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Rename Old script" }),
    );
    await userEvent.click(await canvas.findByTestId("api-token-rename-cancel"));

    await expect(await canvas.findByText("Old script")).toBeVisible();
    await expect(canvas.queryByTestId("api-token-rename-row")).toBeNull();
  },
};

export const RevokesATokenOnceConfirmedInItsRow: Story = {
  beforeEach: withTokens,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Revoke Old script" }),
    );
    await expect(
      await canvas.findByTestId("api-token-revoke-confirm"),
    ).toHaveTextContent("Revoke Old script?");
    await userEvent.click(canvas.getByTestId("api-token-revoke-confirm-3"));

    await said(canvas, "api-tokens-status", "Token revoked.");
    await waitFor(() =>
      expect(canvas.getAllByTestId("api-token-row")).toHaveLength(2),
    );
    await expect(canvas.queryByText("Old script")).toBeNull();
    await expect(server.tokens).toHaveLength(2);
  },
};

export const ShowsWhyARevokeWasRefused: Story = {
  beforeEach({ msw }) {
    withTokens();
    msw.use(
      http.delete(
        "/api/auth/api-tokens/:id",
        () =>
          new HttpResponse("you have no live token with that id", {
            status: 404,
          }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Revoke Old script" }),
    );
    // Another tab revoked it first.
    server.tokens = server.tokens.filter((t) => t.id !== 3);
    await userEvent.click(
      await canvas.findByTestId("api-token-revoke-confirm-3"),
    );

    await said(
      canvas,
      "api-tokens-status",
      "you have no live token with that id",
    );
    // The list is read again, so the row that is gone is gone.
    await waitFor(() =>
      expect(canvas.queryByTestId("api-token-revoke-confirm")).toBeNull(),
    );
    await expect(canvas.getAllByTestId("api-token-row")).toHaveLength(2);
  },
};

export const ShowsWhyARenameWasRefused: Story = {
  beforeEach({ msw }) {
    withTokens();
    msw.use(
      http.patch(
        "/api/auth/api-tokens/:id",
        () =>
          new HttpResponse("you have no live token with that id", {
            status: 404,
          }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Rename Old script" }),
    );
    server.tokens = server.tokens.filter((t) => t.id !== 3);
    await userEvent.click(await canvas.findByTestId("api-token-rename-save"));

    await said(
      canvas,
      "api-tokens-status",
      "you have no live token with that id",
    );
    await waitFor(() =>
      expect(canvas.queryByTestId("api-token-rename-row")).toBeNull(),
    );
    await expect(canvas.getAllByTestId("api-token-row")).toHaveLength(2);
  },
};

export const KeepsEarlierTokensWhenTheListFailedBeforeACreate: Story = {
  beforeEach({ msw }) {
    withTokens();
    let reads = 0;
    msw.use(
      http.get("/api/auth/api-tokens", () => {
        reads += 1;
        return reads === 1
          ? new HttpResponse("list is down", { status: 500 })
          : HttpResponse.json(server.tokens);
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await said(canvas, "api-tokens-status", "list is down");
    await userEvent.type(await canvas.findByLabelText("Token name"), "Laptop");
    await userEvent.click(canvas.getByTestId("api-token-create"));

    // The earlier three come back with the new one: the list was read again.
    await waitFor(() =>
      expect(canvas.getAllByTestId("api-token-row")).toHaveLength(4),
    );
  },
};
