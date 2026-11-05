import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router";
import { expect, waitFor } from "storybook/test";
import { failing } from "../../testing/handlers";
import {
  aWireRequest,
  aWireVersion,
  HYPERION,
  type RequestFake,
  requestFake,
} from "../../testing/requestHandlers";
import { aWireBook, WIRE_ADA } from "../../testing/wire";
import { Requests } from "./Requests";

const CARMILLA = aWireBook({
  title: "Carmilla",
  unique_identifier: "uuid-carmilla",
  creators: [{ name: "Sheridan Le Fanu", role: null, file_as: null, id: 4 }],
  formats: [],
});
const EPUB = aWireVersion({ id: 11 });

const NAMES = { 1: "Ada Lovelace", 2: "Grace Hopper" };
const READER = { ...WIRE_ADA, is_admin: false, can_request: true };

/** Ada's live request, Grace's live request and Grace's cancelled one, newest first by id. */
const HOUSEHOLD = [
  aWireRequest({ id: 3, user_id: 1, state: "looking" }),
  aWireRequest({
    id: 4,
    user_id: 2,
    book_uuid: "uuid-carmilla",
    state: "on_its_way",
    chosen_result_id: EPUB.id,
    progress: 0.4,
    versions: [EPUB],
  }),
  aWireRequest({
    id: 5,
    user_id: 2,
    state: "cancelled",
    cancelled_by: 2,
    chosen_result_id: EPUB.id,
    progress: 0.1,
    versions: [EPUB],
  }),
];

let fake: RequestFake = requestFake();

function Page() {
  return (
    <Routes>
      <Route path="/requests" element={<Requests />} />
      <Route path="/books/:uuid/request" element={<h1>Request page</h1>} />
    </Routes>
  );
}

const meta = {
  title: "Pages/Requests",
  component: Page,
  parameters: { path: "/requests", user: READER },
  beforeEach({ msw }) {
    fake = requestFake(HOUSEHOLD, {
      books: [HYPERION, CARMILLA],
      names: NAMES,
    });
    msw.use(...fake.handlers);
  },
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Everyone: Story = {
  play: async ({ canvas }) => {
    const rows = await canvas.findAllByTestId("requests-row");

    await expect(rows.map((r) => r.dataset.state)).toEqual([
      "cancelled",
      "on_its_way",
      "looking",
    ]);
    const [cancelled, downloading] = rows;
    await expect(cancelled).toHaveTextContent("Hyperion");
    await expect(cancelled).toHaveTextContent("Grace Hopper");
    await expect(cancelled).toHaveTextContent(
      "Cancelled by Grace Hopper · EPUB · 2.4 MB · stopped at 10%",
    );
    await expect(downloading).toHaveTextContent("Carmilla");
    await expect(downloading).toHaveTextContent("On its way");
    await expect(
      canvas.getAllByRole("link", { name: "Hyperion" })[0],
    ).toHaveAttribute("href", "/books/uuid-hyperion/request?id=5");
  },
};

export const CancelShowsOnlyOnYourOwnLiveRequest: Story = {
  play: async ({ canvas }) => {
    await canvas.findAllByTestId("requests-row");

    const cancels = canvas.getAllByTestId("requests-cancel");
    await expect(cancels).toHaveLength(1);
    await expect(cancels[0]).toHaveAccessibleName(
      "Cancel the request for Hyperion",
    );
  },
};

export const AnAdminCanCancelEveryLiveRequest: Story = {
  parameters: { user: { ...WIRE_ADA, is_admin: true } },
  play: async ({ canvas }) => {
    await canvas.findAllByTestId("requests-row");

    await expect(canvas.getAllByTestId("requests-cancel")).toHaveLength(2);
  },
};

export const CancellingFromTheListShowsItCancelledWithUndo: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", {
        name: "Cancel the request for Hyperion",
      }),
    );

    await waitFor(() =>
      expect(
        canvas.getAllByTestId("requests-row").map((r) => r.dataset.state),
      ).toEqual(["cancelled", "on_its_way", "cancelled"]),
    );
    await expect(
      await canvas.findByRole("button", { name: "Undo" }),
    ).toBeInTheDocument();
    await expect(fake.writes).toEqual([{ kind: "cancel", id: 3 }]);
  },
};

export const BookFilter: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findAllByTestId("requests-row");

    await userEvent.type(
      canvas.getByRole("searchbox", { name: "Filter by book" }),
      "fanu",
    );

    const rows = canvas.getAllByTestId("requests-row");
    await expect(rows).toHaveLength(1);
    await expect(rows[0]).toHaveTextContent("Carmilla");
  },
};

export const BookFilterWithNoMatchSaysSo: Story = {
  play: async ({ canvas, userEvent }) => {
    await canvas.findAllByTestId("requests-row");

    await userEvent.type(
      canvas.getByRole("searchbox", { name: "Filter by book" }),
      "Dune",
    );

    await expect(canvas.queryByTestId("requests-row")).toBeNull();
    await expect(canvas.getByTestId("requests-no-match")).toHaveTextContent(
      "No requests for a book matching “Dune”",
    );
  },
};

export const Empty: Story = {
  beforeEach({ msw }) {
    fake = requestFake([]);
    msw.use(...fake.handlers);
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByTestId("requests-empty")).toHaveTextContent(
      "No requests yet",
    );
    await expect(
      canvas.queryByRole("searchbox", { name: "Filter by book" }),
    ).toBeNull();
  },
};

export const AFailedReadOffersTryAgain: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/requests", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toBeInTheDocument();
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  },
};
