import { describe, expect, it } from "vitest";
import { toRequestListing, type UserId } from "../../api";
import {
  aWireListing,
  aWireRequest,
  aWireVersion,
} from "../../testing/requestHandlers";
import { aWireBook } from "../../testing/wire";
import {
  countsLine,
  groupRequests,
  itemLine,
  requestedNotes,
} from "./requestGroups";

const ADA = { id: 1 as UserId, isAdmin: false, canRequest: true };
const EPUB = aWireVersion({ id: 11 });

/** A listed request for the book `uuid`. */
const listing = (
  uuid: string,
  request: Parameters<typeof aWireRequest>[0] = {},
) =>
  toRequestListing(
    aWireListing({
      request: aWireRequest({ book_uuid: uuid, ...request }),
      book: aWireBook({ title: uuid, unique_identifier: uuid }),
    }),
  );

/** Each group's key and its books' uuids, in order. */
const shape = (groups: ReturnType<typeof groupRequests>) =>
  groups.map((g) => [g.key, g.items.map((l) => l.book.uuid)]);

describe("groupRequests", () => {
  describe("grouping", () => {
    it("orders the groups needs you, on its way, looking, stuck, ready, then cancelled", () => {
      const groups = groupRequests(
        [
          listing("gone", { id: 0, state: "cancelled" }),
          listing("ready", { id: 1, state: "ready" }),
          listing("stuck", {
            id: 2,
            state: "stuck",
            stuck_reason: "not_found",
          }),
          listing("looking", { id: 3, state: "looking" }),
          listing("coming", { id: 4, state: "on_its_way" }),
          listing("yours", { id: 5, state: "choose" }),
        ],
        ADA,
      );

      expect(shape(groups)).toEqual([
        ["needs_you", ["yours"]],
        ["on_its_way", ["coming"]],
        ["looking", ["looking"]],
        ["stuck", ["stuck"]],
        ["ready", ["ready"]],
        ["cancelled", ["gone"]],
      ]);
    });

    it("lists a picked version as on its way", () => {
      const groups = groupRequests([listing("b", { state: "chosen" })], ADA);

      expect(shape(groups)).toEqual([["on_its_way", ["b"]]]);
    });

    it("lists another reader's pick still to make as looking", () => {
      const theirs = listing("b", { user_id: 2, state: "choose" });

      expect(shape(groupRequests([theirs], ADA))).toEqual([["looking", ["b"]]]);
    });

    it("lists any pick still to make as needing an admin", () => {
      const admin = { id: 9 as UserId, isAdmin: true, canRequest: true };
      const theirs = listing("b", { user_id: 2, state: "choose" });

      expect(shape(groupRequests([theirs], admin))).toEqual([
        ["needs_you", ["b"]],
      ]);
    });

    it("files a book whose every request was cancelled under cancelled", () => {
      const groups = groupRequests(
        [listing("gone", { state: "cancelled" })],
        ADA,
      );

      expect(shape(groups)).toEqual([["cancelled", ["gone"]]]);
    });
  });

  describe("one item per book", () => {
    it("files a book under its live request when a newer one was cancelled", () => {
      const groups = groupRequests(
        [
          listing("b", { id: 4, state: "cancelled" }),
          listing("b", { id: 3, state: "stuck", stuck_reason: "not_found" }),
        ],
        ADA,
      );

      expect(shape(groups)).toEqual([["stuck", ["b"]]]);
    });

    it("files an all-cancelled book under the request cancelled last", () => {
      const groups = groupRequests(
        [
          listing("b", { id: 5, state: "cancelled", updated_at: 1000 }),
          listing("b", { id: 3, state: "cancelled", updated_at: 2000 }),
        ],
        ADA,
      );

      expect(groups[0]?.items[0]?.request.id).toBe(3);
    });

    it("files a book under its most urgent request", () => {
      const groups = groupRequests(
        [
          listing("b", { id: 3, user_id: 2, state: "looking" }),
          listing("b", { id: 2, state: "on_its_way" }),
          listing("b", { id: 1, state: "cancelled" }),
        ],
        ADA,
      );

      expect(shape(groups)).toEqual([["on_its_way", ["b"]]]);
      expect(groups[0]?.items[0]?.request.id).toBe(2);
    });

    it("files a book under its newest request when two are as urgent", () => {
      const groups = groupRequests(
        [
          listing("b", { id: 3, user_id: 2, state: "looking" }),
          listing("b", { id: 2, state: "looking" }),
        ],
        ADA,
      );

      expect(groups[0]?.items[0]?.request.id).toBe(3);
    });
  });
});

describe("itemLine", () => {
  it.each([
    ["needs_you", { state: "choose" }, "Ebook · choose a version"],
    ["looking", { state: "choose" }, "Ebook · choosing a version"],
    ["looking", { state: "looking" }, "Ebook · looking"],
    ["on_its_way", { state: "chosen" }, "Ebook · on its way"],
    [
      "on_its_way",
      { state: "on_its_way", progress: 0.62, chosen_result_id: EPUB.id },
      "Ebook · on its way · 62%",
    ],
    [
      "stuck",
      { state: "stuck", stuck_reason: "not_found" },
      "Ebook · stuck · couldn’t find it",
    ],
    [
      "stuck",
      { state: "stuck", stuck_reason: "stopped_moving" },
      "Ebook · stuck · stopped moving",
    ],
    ["ready", { state: "ready" }, "Ebook · ready to read"],
    [
      "ready",
      { state: "ready", kind: "audiobook" },
      "Audiobook · ready to listen",
    ],
    ["looking", { state: "looking", kind: "audiobook" }, "Audiobook · looking"],
    ["cancelled", { state: "cancelled" }, "Ebook · cancelled"],
  ] as const)("reads a %s %o as %s", (group, request, expected) => {
    expect(itemLine(listing("b", request), group, false)).toBe(expected);
  });

  describe("on a phone", () => {
    it.each([
      [
        "on_its_way",
        { state: "on_its_way", progress: 0.62, chosen_result_id: EPUB.id },
        "Ebook · 62%",
      ],
      ["on_its_way", { state: "on_its_way" }, "Ebook · on its way"],
      [
        "stuck",
        { state: "stuck", stuck_reason: "not_found" },
        "Ebook · couldn’t find it",
      ],
      [
        "looking",
        { state: "looking", kind: "audiobook" },
        "Audiobook · looking for a version",
      ],
      ["needs_you", { state: "choose" }, "Ebook · choose a version"],
    ] as const)("reads a %s %o as %s", (group, request, expected) => {
      expect(itemLine(listing("b", request), group, true)).toBe(expected);
    });
  });
});

describe("countsLine", () => {
  const groupsOf = (...states: ("choose" | "looking" | "cancelled")[]) =>
    groupRequests(
      states.map((state, i) => listing(`b${i}`, { id: i + 1, state })),
      ADA,
    );

  it.each([
    [
      "one waiting on the viewer",
      groupsOf("choose", "looking"),
      "2 books · 1 needs you",
    ],
    ["two waiting", groupsOf("choose", "choose"), "2 books · 2 need you"],
    ["none waiting", groupsOf("looking"), "1 book"],
    ["only cancelled books", groupsOf("cancelled"), "0 books"],
    ["a cancelled book beside one", groupsOf("looking", "cancelled"), "1 book"],
  ])("counts %s", (_case, groups, expected) => {
    expect(countsLine(groups)).toBe(expected);
  });
});

describe("requestedNotes", () => {
  it("names a book with an ebook request going in the list's words", () => {
    const notes = requestedNotes(
      [
        listing("yours", { id: 1, state: "choose" }),
        listing("coming", { id: 2, state: "on_its_way", progress: 0.62 }),
        listing("looking", { id: 3, state: "looking" }),
        listing("stuck", {
          id: 4,
          state: "stuck",
          stuck_reason: "not_found",
        }),
      ],
      ADA,
    );

    expect(Object.fromEntries(notes)).toEqual({
      yours: "choose a version",
      coming: "on its way · 62%",
      looking: "looking",
      stuck: "stuck · couldn’t find it",
    });
  });

  it("leaves out a cancelled or finished request and an audiobook one", () => {
    const notes = requestedNotes(
      [
        listing("cancelled", { id: 1, state: "cancelled" }),
        listing("ready", { id: 2, state: "ready" }),
        listing("audio", { id: 3, kind: "audiobook", state: "looking" }),
      ],
      ADA,
    );

    expect([...notes.keys()]).toEqual([]);
  });

  it("takes the newest of a book's requests going", () => {
    const notes = requestedNotes(
      [
        listing("b", { id: 9, state: "looking" }),
        listing("b", { id: 8, state: "on_its_way" }),
      ],
      ADA,
    );

    expect(notes.get("b")).toBe("looking");
  });
});
