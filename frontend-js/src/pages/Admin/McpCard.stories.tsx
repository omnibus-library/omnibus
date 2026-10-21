import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor } from "storybook/test";
import { mcpHandlers } from "../../testing/adminHandlers";
import { fakeClipboard } from "../../testing/clipboard";
import { deferred, failing, hanging } from "../../testing/handlers";
import { McpCard } from "./McpCard";

const MCP = "/api/settings/mcp";

const toggles: boolean[] = [];
const copied: string[] = [];

const meta = {
  title: "Pages/Admin/McpCard",
  component: McpCard,
  beforeEach({ msw }) {
    for (const list of [toggles, copied]) list.length = 0;
    msw.use(...mcpHandlers(false, { saved: toggles }));
  },
} satisfies Meta<typeof McpCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const McpLoading: Story = {
  beforeEach({ msw }) {
    msw.use(hanging(MCP));
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", {
        level: 3,
        name: "Hosted MCP endpoint",
      }),
    ).toBeInTheDocument();
    const track = canvas.getByTestId("mcp-toggle");
    await expect(track).not.toHaveAttribute("role");
    await expect(track).not.toHaveAttribute("aria-checked");
    await expect(track).toHaveClass("ld-toggle-unknown");
    await expect(track).toBeDisabled();
    const state = canvas.getByTestId("mcp-toggle-state");
    await expect(state).toHaveTextContent("checking…");
    await expect(state).toHaveClass("ld-sheen");
    await expect(
      canvas.getByText("Checking the endpoint's current state…"),
    ).toBeInTheDocument();
  },
};

export const McpLoadFailed: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", MCP, 500));
  },
  play: async ({ canvas }) => {
    const status = await canvas.findByTestId("mcp-toggle-status");
    await expect(status).toHaveAttribute("role", "status");
    await expect(status).toHaveTextContent("failed with 500");
    await expect(status).toHaveClass("settings-status", "error");
    await expect(canvas.getByTestId("mcp-toggle")).toBeDisabled();
  },
};

export const McpShowsADisabledEndpoint: Story = {
  play: async ({ canvas }) => {
    const toggle = await canvas.findByRole("switch", {
      name: "Hosted MCP endpoint",
    });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(toggle).toBeEnabled();
    await expect(toggle).not.toHaveClass("on");
    await expect(toggle).not.toHaveClass("ld-toggle-unknown");
    await expect(canvas.getByTestId("mcp-toggle-state")).toHaveTextContent(
      "disabled",
    );
    await expect(
      canvas.getByText(
        "/mcp answers 404 until this is on. Instance-wide, and off by default.",
      ),
    ).toBeInTheDocument();
    await expect(canvas.getByText("admin")).toHaveClass("tkx-admin-tag");
  },
};

export const McpShowsAnEnabledEndpoint: Story = {
  beforeEach({ msw }) {
    msw.use(...mcpHandlers(true, { saved: toggles }));
  },
  play: async ({ canvas }) => {
    const toggle = await canvas.findByRole("switch", {
      name: "Hosted MCP endpoint",
    });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(toggle).toHaveClass("on");
    await expect(canvas.getByTestId("mcp-toggle-state")).toHaveTextContent(
      "enabled",
    );
    await expect(
      canvas.getByText(
        "Serving this library's MCP tools over streamable HTTP at /mcp. Clients authenticate with a token above.",
      ),
    ).toBeInTheDocument();
  },
};

export const McpEnablesTheEndpoint: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("switch", { name: "Hosted MCP endpoint" }),
    );

    await expect(
      await canvas.findByText("MCP endpoint enabled at /mcp."),
    ).toHaveClass("settings-status", "success");
    await expect(toggles).toEqual([true]);
    await expect(canvas.getByTestId("mcp-toggle-state")).toHaveTextContent(
      "enabled",
    );
    await expect(canvas.getByRole("switch")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  },
};

export const McpDisablesTheEndpoint: Story = {
  beforeEach({ msw }) {
    msw.use(...mcpHandlers(true, { saved: toggles }));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("switch", { name: "Hosted MCP endpoint" }),
    );

    await expect(
      await canvas.findByText("MCP endpoint disabled. /mcp now answers 404."),
    ).toHaveClass("settings-status", "success");
    await expect(toggles).toEqual([false]);
    await expect(canvas.getByTestId("mcp-toggle-state")).toHaveTextContent(
      "disabled",
    );
  },
};

export const McpShowsAToggleRefusalAndKeepsTheState: Story = {
  beforeEach({ msw }) {
    msw.use(failing("post", MCP, 403));
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("switch", { name: "Hosted MCP endpoint" }),
    );

    const status = await canvas.findByText("failed with 403");
    await expect(status).toHaveClass("settings-status", "error");
    await expect(canvas.getByTestId("mcp-toggle-state")).toHaveTextContent(
      "disabled",
    );
    await expect(canvas.getByRole("switch")).toBeEnabled();
  },
};

let writeGate = deferred();

export const McpHoldsTheSwitchWhileSaving: Story = {
  beforeEach({ msw }) {
    writeGate = deferred();
    msw.use(
      http.post(MCP, async () => {
        await writeGate.promise;
        return new HttpResponse(null, { status: 204 });
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const toggle = await canvas.findByRole("switch", {
      name: "Hosted MCP endpoint",
    });
    await userEvent.click(toggle);

    await waitFor(() => expect(toggle).toBeDisabled());
    writeGate.release();
    await waitFor(() => expect(toggle).toBeEnabled());
  },
};

export const McpDrawsAFullSizeCopyButton: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByTestId("mcp-endpoint-copy"),
    ).toHaveAttribute("class", "btn ghost");
  },
};

export const McpCopiesTheEndpointUrl: Story = {
  beforeEach: () => fakeClipboard(copied),
  play: async ({ canvas, userEvent }) => {
    const endpoint = `${window.location.origin}/mcp`;
    await expect(
      await canvas.findByTestId("mcp-endpoint-url"),
    ).toHaveTextContent(endpoint);
    await userEvent.click(canvas.getByRole("button", { name: "Copy URL" }));

    await expect(
      await canvas.findByTestId("mcp-endpoint-copy-feedback"),
    ).toHaveTextContent("Copied");
    await expect(copied).toEqual([endpoint]);
  },
};
