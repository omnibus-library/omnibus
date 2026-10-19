import type { Meta, StoryObj } from "@storybook/react-vite";
import { Route, Routes } from "react-router";
import type {
  AddPhysicalOnlyRequest,
  CheckInRequest,
  ExternalBookMeta,
  ScanOutcome,
  WishlistAddRequest,
} from "../../api/generated/schemas";
import {
  anExternalBook,
  aScanBook,
  googleBooksHandler,
  scanHandlers,
} from "../../testing/scanHandlers";
import { CheckIn } from "./CheckIn";

// Shared by the three CheckIn story files; the name keeps it out of the `*.stories.tsx` glob.

export const ISBN = "9780134685991";
export const BOOK = aScanBook();
export const ONLINE = anExternalBook();

export const resolved: string[] = [];
export const resolvedMeta: ExternalBookMeta[] = [];
export const searched: string[] = [];
export const checkedIn: CheckInRequest[] = [];
export const physicalOnly: AddPhysicalOnlyRequest[] = [];
export const wishlisted: WishlistAddRequest[] = [];

/** The page, with stand-ins for where it leaves to. */
export function Page() {
  return (
    <Routes>
      <Route path="/check-in" element={<CheckIn />} />
      <Route path="/" element={<h1>Library</h1>} />
      <Route path="/books/:uuid" element={<p>Book page</p>} />
    </Routes>
  );
}

export const handlers = (
  outcome: ScanOutcome,
  options: Parameters<typeof scanHandlers>[1] = {},
) =>
  scanHandlers(outcome, {
    resolved,
    resolvedMeta,
    searched,
    found: [
      ONLINE,
      anExternalBook({
        isbn13: "9780306406157",
        title: "Harbour Lights Revisited",
      }),
    ],
    checkedIn,
    physicalOnly,
    wishlisted,
    ...options,
  });

/** What every story starts from: the recorders emptied and a library book to check in. */
export const resetCheckIn: NonNullable<Meta<typeof Page>["beforeEach"]> = ({
  msw,
}) => {
  for (const list of [
    resolved,
    resolvedMeta,
    searched,
    checkedIn,
    physicalOnly,
    wishlisted,
  ]) {
    list.length = 0;
  }
  msw.use(
    ...handlers({ kind: "in_library_unowned", book: BOOK }),
    googleBooksHandler(true),
  );
};

export type Ctx = Parameters<NonNullable<StoryObj<typeof Page>["play"]>>[0];

/** Types an ISBN into the lookup and submits it. */
export async function lookUp({
  canvas,
  userEvent,
}: Pick<Ctx, "canvas" | "userEvent">) {
  await userEvent.type(await canvas.findByTestId("check-in-isbn"), ISBN);
  await userEvent.click(canvas.getByTestId("check-in-submit"));
}

export const CLOSE_MATCH = (
  others: ReturnType<typeof aScanBook>[],
): ScanOutcome => ({
  kind: "close_match",
  book: aScanBook({ isbn: "9781111111111" }),
  others,
  scanned: ONLINE,
});
