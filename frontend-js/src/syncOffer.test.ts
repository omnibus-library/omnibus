import { afterEach, describe, expect, it } from "vitest";
import type { ListeningCandidate, ListeningResume } from "./api";
import {
  dismissedClock,
  listeningOffer,
  newestDismissed,
  playerOfferCopy,
  playerOfferVisible,
  readerOfferCopy,
  readerOfferVisible,
  shouldOffer,
  storeDismissedClock,
} from "./syncOffer";

const OFFER: ListeningCandidate = {
  fileId: 917,
  seconds: 3725,
  sourceClock: 100,
  sourceAhead: true,
};

const resume = (overrides: Partial<ListeningResume>): ListeningResume => ({
  state: "candidate",
  follow: false,
  candidate: OFFER,
  ...overrides,
});

afterEach(() => localStorage.clear());

describe("shouldOffer", () => {
  it("re-arms only once the source clock passes the answered one", () => {
    expect(shouldOffer(100, null)).toBe(true);
    expect(shouldOffer(100, 100)).toBe(false);
    expect(shouldOffer(101, 100)).toBe(true);
  });
});

describe("dismissal memory", () => {
  it("never moves the stored clock backwards", () => {
    // An older tab answering 100 after another answered 101 must not re-arm the 101 offer.
    expect(newestDismissed(101, 100)).toBe(101);
    expect(newestDismissed(100, 101)).toBe(101);
    expect(newestDismissed(null, 100)).toBe(100);
  });

  it("keeps each account's answer apart for the same book", () => {
    storeDismissedClock(1, "book-a", "audio", 100);

    expect(dismissedClock(1, "book-a", "audio")).toBe(100);
    expect(dismissedClock(2, "book-a", "audio")).toBeNull();
    expect(dismissedClock(1, "book-a", "epub")).toBeNull();
  });

  it("stores under the omn.syncprompt key", () => {
    storeDismissedClock(7, "book-a", "epub", 42);

    expect(localStorage.getItem("omn.syncprompt::7::book-a::epub")).toBe("42");
  });
});

describe("readerOfferCopy", () => {
  it("says further when the listening is ahead or unknown", () => {
    expect(readerOfferCopy(42, null)).toEqual({
      title: "Listened further in the audiobook",
      detail: "Your listening maps to about 42% through.",
    });
  });

  it("says earlier when the listening is behind", () => {
    expect(readerOfferCopy(42, false)?.title).toBe(
      "Audiobook is earlier in the book",
    );
    expect(readerOfferCopy(42, false)?.detail).toContain("before this page");
  });

  it("offers nothing without a percent to name", () => {
    expect(readerOfferCopy(undefined, true)).toBeNull();
  });
});

describe("playerOfferCopy", () => {
  it("names the mapped time and its direction", () => {
    expect(playerOfferCopy(3725, true)).toEqual({
      title: "Read further in the ebook",
      detail: "Your reading maps to about 1:02:05.",
    });
    expect(playerOfferCopy(3725, false)?.title).toBe(
      "Re-reading earlier in the ebook",
    );
  });
});

describe("listeningOffer", () => {
  it("offers the candidate when follow is off", () => {
    expect(listeningOffer(resume({}))).toBe(OFFER);
  });

  it("offers nothing when follow is on, which resolves at boot instead", () => {
    expect(listeningOffer(resume({ follow: true }))).toBeNull();
  });

  it("offers nothing when the formats are already aligned", () => {
    expect(listeningOffer(resume({ state: "aligned" }))).toBeNull();
    expect(listeningOffer(null)).toBeNull();
  });
});

describe("readerOfferVisible", () => {
  it("shows an unanswered offer", () => {
    expect(readerOfferVisible(100, false, null)).toBe(true);
  });

  it("hides under the failed-load overlay, where it would sit in the tab order", () => {
    expect(readerOfferVisible(100, true, null)).toBe(false);
  });

  it("hides an offer already answered", () => {
    expect(readerOfferVisible(100, false, 100)).toBe(false);
  });
});

describe("playerOfferVisible", () => {
  it("shows a ready, unanswered offer for the loaded file", () => {
    expect(playerOfferVisible(OFFER, true, false, 917, null)).toBe(true);
  });

  it("hides until a source is committed, and once playback fails", () => {
    expect(playerOfferVisible(OFFER, false, false, 917, null)).toBe(false);
    expect(playerOfferVisible(OFFER, true, true, 917, null)).toBe(false);
  });

  it("hides when another file is loaded, or the candidate names none", () => {
    // The candidate's seconds count from the start of file 917.
    expect(playerOfferVisible(OFFER, true, false, 940, null)).toBe(false);
    expect(
      playerOfferVisible({ ...OFFER, fileId: null }, true, false, null, null),
    ).toBe(false);
  });

  it("hides an offer already answered", () => {
    expect(playerOfferVisible(OFFER, true, false, 917, 100)).toBe(false);
  });
});
