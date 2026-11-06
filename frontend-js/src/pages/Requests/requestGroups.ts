import type { BookRequest, RequestListing, User } from "../../api";
import { bookCount } from "../../format";
import {
  canActOn,
  kindLabel,
  progressPercent,
  stateView,
} from "../BookRequest/requestView";

/** Where a book stands on the Requests list, most urgent first. */
export const GROUP_ORDER = [
  "needs_you",
  "on_its_way",
  "looking",
  "stuck",
  "ready",
] as const;

export type RequestGroupKey = (typeof GROUP_ORDER)[number];

/** Each group's label above its books. */
export const GROUP_LABELS: Record<RequestGroupKey, string> = {
  needs_you: "Needs you",
  on_its_way: "On its way",
  looking: "Looking",
  stuck: "Stuck",
  ready: "Ready",
};

type Viewer = Pick<User, "id" | "isAdmin" | "canRequest">;

/** The group a request files its book under; `null` for a cancelled one, which only the book's history keeps. */
function groupOf(request: BookRequest, viewer: Viewer): RequestGroupKey | null {
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
      return null;
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

/** The Requests list: one item per book, filed under its most urgent request (the newest of equals), in `GROUP_ORDER`, empty groups left out. `listings` come newest first. */
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
    if (key === null) continue;
    const rank = GROUP_ORDER.indexOf(key);
    const held = filed.get(listing.book.uuid);
    if (!held || rank < held.rank) {
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

function whereItStands({ request }: RequestListing, group: RequestGroupKey) {
  switch (request.state) {
    case "choose":
      return group === "needs_you" ? "choose a version" : "choosing a version";
    case "looking":
      return "looking";
    case "chosen":
      return "on its way";
    case "on_its_way":
      return request.progress === null
        ? "on its way"
        : `on its way · ${progressPercent(request.progress)}%`;
    case "stuck":
      return `stuck · ${stateView("stuck", request.stuckReason).heading.toLowerCase()}`;
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

/** An item's second line: its format, then where it stands, "Ebook · on its way · 62%". */
export const itemLine = (listing: RequestListing, group: RequestGroupKey) =>
  `${kindLabel(listing.request.kind)} · ${whereItStands(listing, group)}`;

/** The line under the heading: "7 books · 1 needs you", the second half only when one does. */
export function countsLine(groups: readonly RequestGroup[]): string {
  const books = groups.reduce((n, g) => n + g.items.length, 0);
  const needs = groups.find((g) => g.key === "needs_you")?.items.length ?? 0;
  const waiting =
    needs === 0 ? "" : ` · ${needs} ${needs === 1 ? "needs" : "need"} you`;
  return `${bookCount(books)}${waiting}`;
}
