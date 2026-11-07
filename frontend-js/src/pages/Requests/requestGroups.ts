import type { BookRequest, RequestListing, User } from "../../api";
import { bookCount } from "../../format";
import {
  canActOn,
  downloadPercent,
  kindLabel,
  stateView,
} from "../BookRequest/requestView";

/** Where a book stands on the Requests list, most urgent first. */
export const GROUP_ORDER = [
  "needs_you",
  "on_its_way",
  "looking",
  "stuck",
  "ready",
  "cancelled",
] as const;

export type RequestGroupKey = (typeof GROUP_ORDER)[number];

/** Each group's label above its books. */
export const GROUP_LABELS: Record<RequestGroupKey, string> = {
  needs_you: "Needs you",
  on_its_way: "On its way",
  looking: "Looking",
  stuck: "Stuck",
  ready: "Ready",
  cancelled: "Cancelled",
};

type Viewer = Pick<User, "id" | "isAdmin" | "canRequest">;

/** The group a request files its book under. */
function groupOf(request: BookRequest, viewer: Viewer): RequestGroupKey {
  switch (request.state) {
    case "choose":
      return canActOn(viewer, request) ? "needs_you" : "looking";
    case "looking":
      return "looking";
    case "chosen":
    case "on_its_way":
      return "on_its_way";
    case "stuck":
      return "stuck";
    case "ready":
      return "ready";
    case "cancelled":
      return "cancelled";
    default: {
      const _exhaustive: never = request.state;
      return _exhaustive;
    }
  }
}

/** One group of the list: its books, each by the request it is filed under. */
export type RequestGroup = {
  key: RequestGroupKey;
  label: string;
  items: RequestListing[];
};

/** The Requests list: one item per book, filed under its most urgent request (the newest of equals; the last cancelled among cancelled ones), in `GROUP_ORDER`, empty groups left out. `listings` come newest first. */
export function groupRequests(
  listings: readonly RequestListing[],
  viewer: Viewer,
): RequestGroup[] {
  const filed = new Map<
    string,
    { rank: number; key: RequestGroupKey; listing: RequestListing }
  >();
  for (const listing of listings) {
    const key = groupOf(listing.request, viewer);
    const rank = GROUP_ORDER.indexOf(key);
    const held = filed.get(listing.book.uuid);
    if (
      !held ||
      rank < held.rank ||
      (key === "cancelled" &&
        rank === held.rank &&
        listing.request.updatedAt > held.listing.request.updatedAt)
    ) {
      filed.set(listing.book.uuid, { rank, key, listing });
    }
  }
  const items = [...filed.values()];
  return GROUP_ORDER.map((key) => ({
    key,
    label: GROUP_LABELS[key],
    items: items.filter((i) => i.key === key).map((i) => i.listing),
  })).filter((group) => group.items.length > 0);
}

/** Where a request stands, after its format. A phone drops the group's own word, so a download reads "62%" and a stuck one its reason alone. */
function whereItStands(
  { request }: RequestListing,
  group: RequestGroupKey,
  phone: boolean,
) {
  switch (request.state) {
    case "choose":
      return group === "needs_you" ? "choose a version" : "choosing a version";
    case "looking":
      return phone ? "looking for a version" : "looking";
    case "chosen":
      return "on its way";
    case "on_its_way": {
      const percent = downloadPercent(request);
      if (percent === null) return "on its way";
      return phone ? `${percent}%` : `on its way · ${percent}%`;
    }
    case "stuck": {
      const reason = stateView(
        "stuck",
        request.stuckReason,
      ).heading.toLowerCase();
      return phone ? reason : `stuck · ${reason}`;
    }
    case "ready":
      return request.kind === "audiobook" ? "ready to listen" : "ready to read";
    case "cancelled":
      return "cancelled";
    default: {
      const _exhaustive: never = request.state;
      return _exhaustive;
    }
  }
}

/** An item's second line: its format, then where it stands, "Ebook · on its way · 62%" ("Ebook · 62%" on a phone). */
export const itemLine = (
  listing: RequestListing,
  group: RequestGroupKey,
  phone: boolean,
) =>
  `${kindLabel(listing.request.kind)} · ${whereItStands(listing, group, phone)}`;

/** The line under the heading: "7 books · 1 needs you", the second half only when one does; cancelled books are not counted. */
export function countsLine(groups: readonly RequestGroup[]): string {
  const books = groups
    .filter((g) => g.key !== "cancelled")
    .reduce((n, g) => n + g.items.length, 0);
  const needs = groups.find((g) => g.key === "needs_you")?.items.length ?? 0;
  const waiting =
    needs === 0 ? "" : ` · ${needs} ${needs === 1 ? "needs" : "need"} you`;
  return `${bookCount(books)}${waiting}`;
}

/** Each book with an ebook request going (finished and cancelled ones don't count), by uuid, where its newest one stands in the list's words. `listings` come newest first. */
export function requestedNotes(
  listings: readonly RequestListing[],
  viewer: Viewer,
): Map<string, string> {
  const notes = new Map<string, string>();
  for (const listing of listings) {
    const { request, book } = listing;
    const group = groupOf(request, viewer);
    if (request.kind !== "ebook" || group === null || group === "ready") {
      continue;
    }
    if (!notes.has(book.uuid)) {
      notes.set(book.uuid, whereItStands(listing, group, false));
    }
  }
  return notes;
}
