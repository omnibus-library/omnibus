import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { Link, Route, Routes, useLocation } from "react-router";
import { expect, waitFor, within } from "storybook/test";
import { deferred, failing } from "../../testing/handlers";
import {
  aWireListing,
  aWireRequest,
  aWireVersion,
  HYPERION,
  type RequestFake,
  requestFake,
} from "../../testing/requestHandlers";
import { aWireBook, WIRE_ADA } from "../../testing/wire";
import { FROM_WISHLISTS } from "../BookRequest/requestView";
import { PHONE } from "../Wishlists/Wishlists.stories.shared";
import { Requests } from "./Requests";

const FOLDS_KEY = "omnibus.requests_folds";

const bookOf = (title: string, author: string) =>
  aWireBook({
    title,
    unique_identifier: `uuid-${title.toLowerCase()}`,
    creators: [{ name: author, role: null, file_as: null, id: 4 }],
    formats: [],
  });

const CARMILLA = bookOf("Carmilla", "Sheridan Le Fanu");
const DRACULA = bookOf("Dracula", "Bram Stoker");
const DUNE = bookOf("Dune", "Frank Herbert");
const BOOKS = [HYPERION, CARMILLA, DRACULA, DUNE];
const EPUB = aWireVersion({ id: 11 });

const NAMES = { 1: "Ada Lovelace", 2: "Grace Hopper" };
const READER = {
  ...WIRE_ADA,
  is_admin: false,
  can_request: true,
  book_requests: true,
};
const GRACE = { ...READER, id: 2, display_name: "Grace Hopper" };

/** Ada's pick to make on Dracula, Grace's download of Carmilla, Ada's search for Hyperion beside Grace's cancelled one, and a cancelled Dune. */
const HOUSEHOLD = [
  aWireRequest({
    id: 2,
    book_uuid: "uuid-dune",
    state: "cancelled",
  }),
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
    updated_at: Date.UTC(2026, 9, 12, 12) / 1000,
    chosen_result_id: EPUB.id,
    progress: 0.1,
    versions: [EPUB],
  }),
  aWireRequest({
    id: 6,
    user_id: 1,
    book_uuid: "uuid-dracula",
    state: "choose",
    versions: [EPUB],
  }),
];

let fake: RequestFake = requestFake();

/** Answers each book's own read. */
const booksHandler = http.get("/api/ebooks/:uuid", ({ params }) => {
  const book = BOOKS.find((b) => b.unique_identifier === params.uuid);
  return book
    ? HttpResponse.json(book)
    : new HttpResponse(null, { status: 404 });
});

/** Where the router is, so a story can see what an item opened. */
function Where() {
  const { pathname, search } = useLocation();
  return (
    <output data-testid="where">
      {pathname}
      {search}
    </output>
  );
}

function Page() {
  return (
    <>
      <Routes>
        <Route path="/requests" element={<Requests />} />
        <Route
          path="/start"
          element={
            <Link to="/requests?book=uuid-hyperion" state={FROM_WISHLISTS}>
              Request Hyperion
            </Link>
          }
        />
      </Routes>
      <Where />
    </>
  );
}

const meta = {
  title: "Pages/Requests",
  component: Page,
  parameters: { path: "/requests", user: READER },
  beforeEach({ msw }) {
    // Storybook's browser project keeps localStorage between stories.
    localStorage.removeItem(FOLDS_KEY);
    fake = requestFake(HOUSEHOLD, {
      books: BOOKS,
      names: NAMES,
    });
    msw.use(
      booksHandler,
      ...fake.handlers,
      http.get("/api/wishlists", () => HttpResponse.json([])),
    );
  },
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Each group's label, its count and its books' titles, in order; a folded group lists none. */
async function groupsOn(canvas: ReturnType<typeof within>) {
  await canvas.findAllByTestId("requests-group-looking");
  return canvas
    .getAllByTestId(/^requests-group-/)
    .map((section: HTMLElement) => [
      section.querySelector('[id^="rqs-group-"]')?.textContent,
      section.querySelector(".rqs-group-count")?.textContent,
      within(section)
        .queryAllByTestId("requests-item")
        .map(
          (item: HTMLElement) =>
            item.querySelector(".rqs-item-title")?.textContent,
        ),
    ]);
}

export const GroupsEachBookUnderWhereItStands: Story = {
  play: async ({ canvas }) => {
    await expect(await groupsOn(canvas)).toEqual([
      ["Needs you", "1", ["Dracula"]],
      ["On its way", "1", ["Carmilla"]],
      ["Looking", "1", ["Hyperion"]],
    ]);
    await expect(canvas.getByTestId("requests-counts")).toHaveTextContent(
      "3 books · 1 needs you",
    );
    const lines = canvas.getAllByTestId("requests-item-line");
    await expect(lines.map((line) => line.textContent)).toEqual([
      "Ebook · choose a version",
      "Ebook · on its way · 40%",
      "Ebook · looking",
    ]);
  },
};

export const AnotherReadersPickIsStillLookingToYou: Story = {
  parameters: { user: GRACE },
  play: async ({ canvas }) => {
    await expect(await groupsOn(canvas)).toEqual([
      ["On its way", "1", ["Carmilla"]],
      ["Looking", "2", ["Dracula", "Hyperion"]],
    ]);
  },
};

export const TheFirstBookIsSelectedAndNamedInTheAddress: Story = {
  play: async ({ canvas }) => {
    const pane = within(await canvas.findByTestId("requests-pane"));

    await expect(
      await pane.findByRole("heading", { level: 2, name: "Dracula" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(canvas.getByTestId("where")).toHaveTextContent(
        "/requests?book=uuid-dracula",
      ),
    );
    await expect(
      canvas.getByRole("link", { name: /Dracula/, current: true }),
    ).toBeInTheDocument();
  },
};

export const ThePaneNamesWhoAskedForTheSelectedBook: Story = {
  parameters: { path: "/requests?book=uuid-carmilla" },
  play: async ({ canvas }) => {
    const pane = within(await canvas.findByTestId("requests-pane"));

    await expect(
      await pane.findByTestId("request-requester"),
    ).toHaveTextContent("requested by GH Grace Hopper");
    await expect(pane.getByTestId("request-state")).toHaveTextContent(
      "On its way",
    );
  },
};

export const SelectingABookShowsItsRequestAndHistory: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("link", { name: /Hyperion/ }),
    );

    await waitFor(() =>
      expect(canvas.getByTestId("where")).toHaveTextContent(
        "/requests?book=uuid-hyperion",
      ),
    );
    const pane = within(await canvas.findByTestId("requests-pane"));
    await expect(
      await pane.findByRole("heading", { level: 2, name: "Hyperion" }),
    ).toBeInTheDocument();
    await expect(
      await pane.findByTestId("request-history-row"),
    ).toHaveTextContent("Cancelled by Grace Hopper · EPUB · 2.4 MB");
  },
};

export const CancellingKeepsTheBookInThePaneWithItsUndo: Story = {
  parameters: { path: "/requests?book=uuid-hyperion" },
  play: async ({ canvas, userEvent }) => {
    const pane = within(await canvas.findByTestId("requests-pane"));

    await userEvent.click(await pane.findByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(canvas.queryByRole("link", { name: /Hyperion/ })).toBeNull(),
    );
    await expect(pane.getByTestId("request-state")).toHaveTextContent(
      "Cancelled",
    );
    // The toast's Undo takes the keyboard's focus from the Cancel that is gone.
    await expect(canvas.getByRole("button", { name: "Undo" })).toHaveFocus();
    await expect(fake.writes).toEqual([{ kind: "cancel", id: 3 }]);
  },
};

export const EachGroupFoldsAndUnfoldsOnClick: Story = {
  play: async ({ canvas, userEvent }) => {
    const header = await canvas.findByRole("button", { name: "Looking 1" });
    await expect(header).toHaveAttribute("aria-expanded", "true");
    await expect(canvas.getByRole("link", { name: /Hyperion/ })).toBeVisible();

    await userEvent.click(header);

    await expect(header).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.queryByRole("link", { name: /Hyperion/ })).toBeNull();
    await expect(header).toHaveTextContent("Looking 1");
    await expect(
      canvas.getByTestId("requests-group-looking"),
    ).toHaveAccessibleName("Looking");

    await userEvent.click(header);

    await expect(header).toHaveAttribute("aria-expanded", "true");
    await expect(
      await canvas.findByRole("link", { name: /Hyperion/ }),
    ).toBeInTheDocument();
  },
};

export const AGroupFoldsFromTheKeyboard: Story = {
  play: async ({ canvas, userEvent }) => {
    const header = await canvas.findByRole("button", { name: "Needs you 1" });

    await userEvent.tab();
    await expect(header).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect(canvas.queryByRole("link", { name: /Dracula/ })).toBeNull();

    await userEvent.keyboard(" ");
    await expect(
      await canvas.findByRole("link", { name: /Dracula/ }),
    ).toBeInTheDocument();
  },
};

export const AFoldIsRememberedOnTheDevice: Story = {
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("button", { name: "Looking 1" }),
    );

    await expect(localStorage.getItem(FOLDS_KEY)).toBe('{"looking":true}');
  },
};

export const AFoldedGroupStaysFoldedOnReturn: Story = {
  beforeEach() {
    localStorage.setItem(FOLDS_KEY, '{"on_its_way":true}');
  },
  play: async ({ canvas }) => {
    await expect(await groupsOn(canvas)).toEqual([
      ["Needs you", "1", ["Dracula"]],
      ["On its way", "1", []],
      ["Looking", "1", ["Hyperion"]],
    ]);
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
    await expect(canvas.queryByTestId("requests-counts")).toBeNull();
    await expect(canvas.queryByTestId("requests-pane")).toBeNull();
  },
};

export const AFailedReadOffersTryAgain: Story = {
  beforeEach({ msw }) {
    msw.use(failing("get", "/api/requests", 500));
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "Couldn’t read the requests.",
    );
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  },
};

let reads = 0;

export const AFailedRereadKeepsTheListShown: Story = {
  beforeEach({ msw }) {
    reads = 0;
    msw.use(
      http.get("/api/requests", () => {
        reads += 1;
        return reads === 1
          ? HttpResponse.json([
              aWireListing({ request: aWireRequest({ id: 3 }) }),
            ])
          : new HttpResponse("down", { status: 500 });
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await canvas.findByTestId("requests-item");

    // A cancel has the list read again; that read fails.
    await userEvent.click(
      await within(await canvas.findByTestId("requests-pane")).findByRole(
        "button",
        { name: "Cancel" },
      ),
    );
    await waitFor(() => expect(reads).toBeGreaterThan(1));
    await expect(canvas.getByTestId("requests-item")).toHaveTextContent(
      "Hyperion",
    );
    await expect(
      within(canvas.getByTestId("requests-page")).queryByText(
        "Couldn’t read the requests.",
      ),
    ).toBeNull();
  },
};

let asked = 0;

export const OffOnThisServerItIsNotFound: Story = {
  parameters: { user: { ...READER, book_requests: false } },
  beforeEach({ msw }) {
    asked = 0;
    msw.use(
      http.get("/api/requests", () => {
        asked += 1;
        return HttpResponse.json([]);
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
    await expect(asked).toBe(0);
  },
};

export const ARequestStartedFromAWishlistOffersTheWayBackInThePane: Story = {
  parameters: { path: "/start" },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("link", { name: "Request Hyperion" }),
    );

    const pane = within(await canvas.findByTestId("requests-pane"));
    await expect(
      await pane.findByRole("link", { name: "← Back to Wishlists" }),
    ).toHaveAttribute("href", "/wishlists");

    await userEvent.click(await canvas.findByRole("link", { name: /Dracula/ }));

    // Selecting another book swaps the pane for a new one.
    const next = within(await canvas.findByTestId("requests-pane"));
    await expect(
      await next.findByRole("heading", { level: 2, name: "Dracula" }),
    ).toBeInTheDocument();
    await expect(
      next.queryByRole("link", { name: "← Back to Wishlists" }),
    ).toBeNull();
  },
};

export const OnAPhoneEachBookOpensItsRequestAtItsAddressWithAWayBack: Story = {
  ...PHONE,
  parameters: { ...PHONE.parameters, path: "/requests", user: READER },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("link", { name: /Hyperion/ }),
    );

    await waitFor(() =>
      expect(canvas.getByTestId("where")).toHaveTextContent(
        "/requests?book=uuid-hyperion",
      ),
    );
    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Hyperion" }),
    ).toBeInTheDocument();
    await expect(canvas.queryByTestId("requests-item")).toBeNull();
    const back = await canvas.findByRole("link", { name: "‹ Requests" });
    await expect(back).toHaveAttribute("href", "/requests");

    await userEvent.click(back);

    await expect(await canvas.findAllByTestId("requests-item")).toHaveLength(3);
  },
};

export const OnAPhoneTheBookInTheAddressOpensFullScreen: Story = {
  ...PHONE,
  parameters: {
    ...PHONE.parameters,
    path: "/requests?book=uuid-carmilla",
    user: READER,
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Carmilla" }),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("request-page")).toBeInTheDocument();
    await expect(canvas.queryByTestId("requests-item")).toBeNull();
  },
};

let heldRequests = deferred();

export const OnAPhoneADeepLinkWaitsForTheListWithoutDrawingIt: Story = {
  ...PHONE,
  parameters: {
    ...PHONE.parameters,
    path: "/requests?book=uuid-carmilla",
    user: READER,
  },
  beforeEach({ msw }) {
    heldRequests = deferred();
    msw.use(
      http.get("/api/requests", async () => {
        await heldRequests.promise;
        return HttpResponse.json([
          aWireListing({
            request: aWireRequest({ id: 4, book_uuid: "uuid-carmilla" }),
            book: CARMILLA,
          }),
        ]);
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Loading…")).toBeInTheDocument();
    await expect(canvas.queryByTestId("requests-item")).toBeNull();
    await expect(canvas.queryByText("Gathering the requests")).toBeNull();
    await expect(
      canvas.queryByRole("heading", { name: "Requests" }),
    ).toBeNull();

    heldRequests.release();

    await expect(
      await canvas.findByRole("heading", { level: 1, name: "Carmilla" }),
    ).toBeInTheDocument();
  },
};

export const NarrowingToAPhoneKeepsTheListWhenThePageChoseTheBook: Story = {
  parameters: { path: "/requests", user: READER },
  play: async ({ canvas }) => {
    // The desktop writes the first book into the address on its own.
    await waitFor(() =>
      expect(canvas.getByTestId("where")).toHaveTextContent(
        "/requests?book=uuid-dracula",
      ),
    );
    await canvas.findByTestId("requests-pane");

    await (await import("vitest/browser")).page.viewport(390, 844);

    // The pane goes once the screen is a phone's.
    await waitFor(() =>
      expect(canvas.queryByTestId("requests-pane")).toBeNull(),
    );
    await expect(await canvas.findAllByTestId("requests-item")).toHaveLength(3);
    await expect(canvas.queryByTestId("request-page")).toBeNull();
  },
};

export const OnAPhoneABookTheListLacksShowsTheList: Story = {
  ...PHONE,
  parameters: {
    ...PHONE.parameters,
    path: "/requests?book=uuid-nope",
    user: READER,
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findAllByTestId("requests-item")).toHaveLength(3);
    await expect(canvas.queryByTestId("request-page")).toBeNull();
  },
};

export const OnAPhoneABookOpenedFromAWishlistOffersTheWayBackThere: Story = {
  ...PHONE,
  parameters: { ...PHONE.parameters, path: "/start", user: READER },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(
      await canvas.findByRole("link", { name: "Request Hyperion" }),
    );

    await expect(
      await canvas.findByRole("link", { name: "← Back to Wishlists" }),
    ).toHaveAttribute("href", "/wishlists");
    await expect(canvas.queryByRole("link", { name: "‹ Requests" })).toBeNull();
  },
};

export const OnAPhoneTheListStandsAlone: Story = {
  ...PHONE,
  parameters: { ...PHONE.parameters, path: "/requests", user: READER },
  play: async ({ canvas }) => {
    await canvas.findAllByTestId("requests-item");

    await expect(canvas.queryByTestId("requests-pane")).toBeNull();
    await expect(
      canvas.getByRole("button", { name: "Looking 1" }),
    ).toBeInTheDocument();
    // A phone drops the group's own word from each line.
    await expect(
      canvas.getAllByTestId("requests-item-line").map((l) => l.textContent),
    ).toEqual([
      "Ebook · choose a version",
      "Ebook · 40%",
      "Ebook · looking for a version",
    ]);
  },
};

export const RequestAgainInThePaneStaysOnTheList: Story = {
  parameters: { path: "/requests?book=uuid-dune" },
  play: async ({ canvas, userEvent }) => {
    const pane = within(await canvas.findByTestId("requests-pane"));

    await userEvent.click(
      await pane.findByRole("button", { name: "Request again" }),
    );

    await waitFor(() =>
      expect(fake.writes).toEqual([{ kind: "start", uuid: "uuid-dune" }]),
    );
    await expect(
      await canvas.findByRole("link", { name: /Dune/ }),
    ).toBeInTheDocument();
    await expect(canvas.getByTestId("where")).toHaveTextContent(
      "/requests?book=uuid-dune",
    );
  },
};

let held = deferred();
let listReads = 0;

export const RequestAgainStaysBusyUntilTheRequestsListIsReadAgain: Story = {
  parameters: { path: "/requests?book=uuid-dune" },
  beforeEach({ msw }) {
    held = deferred();
    listReads = 0;
    msw.use(
      http.get("/api/requests", async () => {
        listReads += 1;
        if (listReads > 1) await held.promise;
        return HttpResponse.json([
          aWireListing({
            request: aWireRequest({
              id: 2,
              book_uuid: "uuid-dune",
              state: "cancelled",
            }),
            book: DUNE,
          }),
        ]);
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const pane = within(await canvas.findByTestId("requests-pane"));
    const again = await pane.findByRole("button", { name: "Request again" });

    await userEvent.click(again);

    await waitFor(() => expect(listReads).toBeGreaterThan(1));
    await expect(again).toHaveAttribute("aria-busy", "true");
    held.release();
  },
};
