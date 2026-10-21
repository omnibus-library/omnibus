import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect, waitFor, within } from "storybook/test";
import { userSessionsQuery } from "../../api";
import { storyClient } from "../../testing/AppHarness";
import { sessionsHandlers } from "../../testing/adminHandlers";
import { deferred, failing, hanging } from "../../testing/handlers";
import { aWireAuthSession } from "../../testing/wire";
import { SessionsModal } from "./UserModals";
import {
  ALICE,
  calls,
  close,
  resetUserModals,
  revoked,
} from "./UserModals.stories.shared";
import { UsersCard } from "./UsersCard";

const meta = {
  title: "Pages/Admin/UserModals/Sessions",
  component: UsersCard,
  beforeEach: resetUserModals,
} satisfies Meta<typeof UsersCard>;

export default meta;
type Story = StoryObj<typeof meta>;

let listGate = deferred();

let gatedReads = 0;

// The sessions list answers `first` at once and every later read only once `listGate` opens.
function gatedSessionReads(first: () => Response) {
  gatedReads = 0;
  return http.get("/api/admin/users/:id/sessions", async () => {
    if (++gatedReads === 1) return first();
    await listGate.promise;
    return HttpResponse.json([aWireAuthSession()]);
  });
}

export const SessionsWaitsForBothLists: Story = {
  beforeEach({ msw }) {
    msw.use(hanging("/api/admin/users/:id/devices"));
  },
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    await waitFor(() =>
      expect(
        storyClient().getQueryData(userSessionsQuery(ALICE.id).queryKey),
      ).toBeDefined(),
    );
    await expect(
      within(dialog).getByTestId("user-sessions-loading"),
    ).toHaveTextContent("Reading sessions and devices…");
    await expect(
      within(dialog).queryByRole("heading", { level: 4 }),
    ).not.toBeInTheDocument();
    await expect(
      within(dialog).queryByText("No registered devices."),
    ).not.toBeInTheDocument();
  },
};

export const SessionsListsSessionsAndDevices: Story = {
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    await expect(
      await within(dialog).findByRole("heading", {
        level: 4,
        name: "Sessions",
      }),
    ).toBeInTheDocument();
    await expect(
      within(dialog).getByRole("heading", { level: 4, name: "Devices" }),
    ).toBeInTheDocument();
    await expect(
      within(dialog)
        .getAllByTestId("user-session-row")
        .map((row) => row.firstElementChild?.textContent),
    ).toEqual([
      "Firefox on Linux · last used Oct 10, 2025",
      "Kobo Clara · last used Oct 10, 2025",
    ]);
    await expect(
      within(dialog)
        .getAllByTestId("user-device-row")
        .map((row) => row.firstElementChild?.textContent),
    ).toEqual(["Kobo Clara · kobo · last seen Jan 1, 2024"]);
    await expect(
      within(dialog).getByRole("button", {
        name: "Revoke the session on Firefox on Linux",
      }),
    ).toBeInTheDocument();
    await expect(
      within(dialog).getByRole("button", {
        name: "Revoke the device Kobo Clara",
      }),
    ).toBeInTheDocument();
  },
};

export const SessionsNamesAnUnnamedClient: Story = {
  beforeEach({ msw }) {
    msw.use(
      ...sessionsHandlers({
        sessions: [aWireAuthSession({ client: undefined })],
        devices: [],
      }),
    );
  },
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    await expect(
      await within(dialog).findByRole("button", {
        name: "Revoke the session on Unknown client",
      }),
    ).toBeInTheDocument();
  },
};

export const SessionsShowsTheEmptyLines: Story = {
  beforeEach({ msw }) {
    msw.use(...sessionsHandlers({ sessions: [], devices: [] }));
  },
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    await expect(
      await within(dialog).findByText("No live sessions."),
    ).toBeInTheDocument();
    await expect(
      within(dialog).getByText("No registered devices."),
    ).toBeInTheDocument();
  },
};

export const SessionsRevokesASessionAndReadsBothListsAgain: Story = {
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    await userEvent.click(
      await within(dialog).findByRole("button", {
        name: "Revoke the device Kobo Clara",
      }),
    );

    // The server ends the sessions tied to a revoked device, so both lists must be read again.
    await expect(
      await within(dialog).findByText("No registered devices."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(within(dialog).getAllByTestId("user-session-row")).toHaveLength(1),
    );
    await expect(revoked.devices).toEqual([4]);
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: "Revoke the session on Firefox on Linux",
      }),
    );
    await expect(
      await within(dialog).findByText("No live sessions."),
    ).toBeInTheDocument();
    await expect(revoked.sessions).toEqual([1]);
  },
};

let revokeGate = deferred();

export const SessionsHoldsTheClickedRevokeWhileRevoking: Story = {
  beforeEach({ msw }) {
    revokeGate = deferred();
    msw.use(
      http.delete("/api/admin/sessions/:id", async () => {
        await revokeGate.promise;
        return new HttpResponse(null, { status: 204 });
      }),
    );
  },
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    const revoke = await within(dialog).findByRole("button", {
      name: "Revoke the session on Firefox on Linux",
    });
    await userEvent.click(revoke);

    await waitFor(() => expect(revoke).toHaveTextContent("Revoking…"));
    await expect(revoke).toBeDisabled();
    await expect(revoke).toHaveAttribute("aria-busy", "true");
    await expect(
      within(dialog).getByRole("button", {
        name: "Revoke the device Kobo Clara",
      }),
    ).not.toHaveTextContent("Revoking…");
    revokeGate.release();
    await waitFor(() => expect(revoke).toBeEnabled());
  },
};

export const SessionsShowsARevokeRefusalUntilTheNextRevoke: Story = {
  beforeEach({ msw }) {
    let attempts = 0;
    msw.use(
      http.delete("/api/admin/sessions/:id", () => {
        attempts += 1;
        return attempts === 1
          ? new HttpResponse("session not found", { status: 404 })
          : new HttpResponse(null, { status: 204 });
      }),
    );
  },
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    const revoke = await within(dialog).findByRole("button", {
      name: "Revoke the session on Firefox on Linux",
    });
    await userEvent.click(revoke);

    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "session not found",
    );
    await userEvent.click(revoke);

    await waitFor(() =>
      expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument(),
    );
  },
};

export const SessionsShowsALoadFailure: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/admin/users/:id/sessions", 500));
  },
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );
    await expect(
      within(dialog).queryByTestId("user-sessions-loading"),
    ).not.toBeInTheDocument();
    await expect(
      within(dialog).queryByText("No registered devices."),
    ).not.toBeInTheDocument();
  },
};

export const SessionsHoldsTheRevokeUntilBothListsAreReadAgain: Story = {
  beforeEach({ msw }) {
    listGate = deferred();
    msw.use(gatedSessionReads(() => HttpResponse.json([aWireAuthSession()])));
  },
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    const revoke = await within(dialog).findByRole("button", {
      name: "Revoke the session on Firefox on Linux",
    });
    await userEvent.click(revoke);

    // The second read starts only once the revoke has been answered.
    await waitFor(() => expect(gatedReads).toBe(2));
    await expect(revoked.sessions).toEqual([1]);
    await expect(revoke).toHaveAttribute("aria-busy", "true");
    await expect(revoke).toBeDisabled();
    listGate.release();
    await waitFor(() => expect(revoke).toBeEnabled());
  },
};

export const SessionsClearsARevokeRefusalOnceTheListsAreReadAgain: Story = {
  beforeEach({ msw }) {
    msw.use(failing("delete", "/api/admin/sessions/:id", 404));
  },
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    await userEvent.click(
      await within(dialog).findByRole("button", {
        name: "Revoke the session on Firefox on Linux",
      }),
    );
    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "failed with 404",
    );

    await storyClient().refetchQueries({
      queryKey: userSessionsQuery(ALICE.id).queryKey,
    });

    await waitFor(() =>
      expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument(),
    );
  },
};

export const SessionsKeepsARevokeRefusalThatArrivesWhileTheListsAreRead: Story =
  {
    beforeEach({ msw }) {
      listGate = deferred();
      msw.use(
        gatedSessionReads(() => HttpResponse.json([aWireAuthSession()])),
        failing("delete", "/api/admin/sessions/:id", 404),
      );
    },
    render: () => <SessionsModal user={ALICE} onClose={close} />,
    play: async ({ canvas, userEvent }) => {
      const dialog = await canvas.findByRole("dialog", {
        name: "Sessions & devices — alice",
      });
      const revoke = await within(dialog).findByRole("button", {
        name: "Revoke the session on Firefox on Linux",
      });
      const sessionsKey = userSessionsQuery(ALICE.id).queryKey;
      const reread = storyClient().refetchQueries({ queryKey: sessionsKey });
      await waitFor(() =>
        expect(storyClient().getQueryState(sessionsKey)?.fetchStatus).toBe(
          "fetching",
        ),
      );
      await userEvent.click(revoke);

      await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "failed with 404",
      );
      listGate.release();
      await reread;
      await expect(within(dialog).getByRole("alert")).toHaveTextContent(
        "failed with 404",
      );
    },
  };

export const SessionsHidesALoadFailureWhileTheListsAreReadAgain: Story = {
  beforeEach({ msw }) {
    listGate = deferred();
    msw.use(
      gatedSessionReads(
        () => new HttpResponse("failed with 500", { status: 500 }),
      ),
    );
  },
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    await expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "failed with 500",
    );

    void storyClient().refetchQueries({
      queryKey: userSessionsQuery(ALICE.id).queryKey,
    });

    await waitFor(() =>
      expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument(),
    );
    await expect(
      within(dialog).getByTestId("user-sessions-loading"),
    ).toBeInTheDocument();
    listGate.release();
    await expect(
      await within(dialog).findByTestId("user-sessions-list"),
    ).toBeInTheDocument();
  },
};

export const SessionsCloseButtonsClose: Story = {
  render: () => <SessionsModal user={ALICE} onClose={close} />,
  play: async ({ canvas, userEvent }) => {
    const dialog = await canvas.findByRole("dialog", {
      name: "Sessions & devices — alice",
    });
    const buttons = within(dialog).getAllByRole("button", { name: "Close" });
    await expect(buttons).toHaveLength(2);

    for (const button of buttons) await userEvent.click(button);

    await expect(calls.closed).toBe(2);
  },
};

export const SessionsButtonOpensTheUsersSessions: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Sessions for alice" }),
    );

    await expect(
      await canvas.findByRole("dialog", { name: "Sessions & devices — alice" }),
    ).toBeInTheDocument();
  },
};
