import { Route, Routes, useLocation } from "react-router";
import { anExternalBook } from "../../testing/scanHandlers";
import {
  type WishlistFake,
  wishlistFake,
} from "../../testing/wishlistHandlers";
import { Wishlists } from "./Wishlists";

// Shared by the Wishlists story files; the name keeps it out of the `*.stories.tsx` glob.

function Where() {
  const { pathname, search } = useLocation();
  return (
    <>
      <h1>Book page</h1>
      <output data-testid="where">
        {pathname}
        {search}
      </output>
    </>
  );
}

/** The page, with a stand-in for the book page it links to. */
export function Page() {
  return (
    <Routes>
      <Route path="/wishlists" element={<Wishlists />} />
      <Route path="/books/:uuid" element={<Where />} />
    </Routes>
  );
}

/** The fake in use by the story that is running; `api` replaces it with a fresh one. */
export let fake: WishlistFake = wishlistFake();

/** What the providers know: another edition of a book the library has, and a book it lacks. */
export const PROVIDER_BOOKS = [
  anExternalBook({
    isbn13: "9781635575637",
    title: "Piranesi",
    authors: ["Susanna Clarke"],
    year: "2020",
    publisher: "Bloomsbury",
    series: null,
  }),
  anExternalBook({
    isbn13: "9780306406157",
    title: "Piranesi and the Vanishing House",
    authors: ["Lena Holt"],
    year: "2018",
    publisher: null,
    series: null,
  }),
];

/** A fresh fake for the story that is starting, and its handlers. */
export function api(seed?: Parameters<typeof wishlistFake>[0]) {
  fake = wishlistFake({ providers: PROVIDER_BOOKS, ...seed });
  return fake.handlers;
}

/** A phone-width screen, where the panel is a menu under the title. */
export const PHONE = {
  globals: { viewport: { value: "phone", isRotated: false } },
  parameters: {
    viewport: {
      options: {
        phone: { name: "Phone", styles: { width: "390px", height: "844px" } },
      },
    },
  },
};

/** The copy the page must not use: a bare "wish" word, or "check in". */
export const BANNED_COPY = /\bwish(es|ed)?\b|check in/i;
