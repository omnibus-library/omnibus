import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aWireBookReviews,
  aWireOtherReview,
  aWireReview,
  aWireReviewSummary,
} from "../testing/wire";
import { ApiError, type BookUuid } from "./core";
import { saveReview, toBookReviews, toReviewPatch } from "./reviews";

describe("toReviewPatch", () => {
  it("sends only the fields the change names", () => {
    expect(toReviewPatch({ stars: 4.5 })).toEqual({ stars: 4.5 });
    expect(toReviewPatch({ spoiler: false })).toEqual({ spoiler: false });
    expect(toReviewPatch({})).toEqual({});
  });

  it("sends a cleared field as null, so the server clears it rather than keeping it", () => {
    expect(toReviewPatch({ stars: null })).toEqual({ stars: null });
    expect(toReviewPatch({ bodyMd: null, notesMd: null })).toEqual({
      body_md: null,
      notes_md: null,
    });
  });

  it("sends blank text as null", () => {
    expect(toReviewPatch({ bodyMd: "  \n ", notesMd: "" })).toEqual({
      body_md: null,
      notes_md: null,
    });
  });

  it("keeps text as written, surrounding whitespace included", () => {
    expect(toReviewPatch({ bodyMd: "  Loved it.\n" })).toEqual({
      body_md: "  Loved it.\n",
    });
  });

  it("drops a field left undefined, which JSON would otherwise lose silently", () => {
    const patch = toReviewPatch({ stars: undefined, bodyMd: "Yes." });
    expect(Object.keys(patch)).toEqual(["body_md"]);
  });
});

describe("toBookReviews", () => {
  it("maps the wire shape, notes and spoiler flags included", () => {
    const reviews = toBookReviews(
      aWireBookReviews({
        mine: aWireReview({ notes_md: "mine", notes_html: "<p>mine</p>" }),
        others: [aWireOtherReview({ spoiler: true, has_avatar: undefined })],
        summary: aWireReviewSummary(4, 3.5),
      }),
    );

    expect(reviews.mine).toMatchObject({
      stars: 4,
      notesMd: "mine",
      notesHtml: "<p>mine</p>",
      bodyMd: null,
    });
    expect(reviews.others[0]).toMatchObject({
      reader: { id: 7, name: "grace", hasAvatar: false },
      stars: 3.5,
      spoiler: true,
    });
    expect(reviews.summary).toMatchObject({ average: 3.75, ratings: 2 });
    expect(reviews.summary?.buckets).toHaveLength(10);
  });

  it("reads a book nobody reviewed as no review and no summary", () => {
    expect(toBookReviews(aWireBookReviews())).toEqual({
      mine: null,
      others: [],
      summary: null,
    });
  });
});

describe("saveReview", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the merge patch and reads back the stored review", async () => {
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      return Response.json(aWireReview({ stars: 2 }));
    });

    const saved = await saveReview("u" as BookUuid, { stars: 2 });

    expect(sent).toEqual([{ stars: 2 }]);
    expect(saved?.stars).toBe(2);
  });

  it("answers null when the change emptied the review", async () => {
    vi.stubGlobal("fetch", async () => Response.json(null));
    await expect(saveReview("u" as BookUuid, { stars: null })).resolves.toBe(
      null,
    );
  });

  it("rejects with the server's text on a plain-text failure", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("stars must be in half steps", {
          status: 400,
          headers: { "content-type": "text/plain" },
        }),
    );
    const err = await saveReview("u" as BookUuid, { stars: 4.2 }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 400,
      message: "stars must be in half steps",
    });
  });

  it("rejects a 200 body that is not a review", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ stars: "five" }));
    await expect(saveReview("u" as BookUuid, { stars: 5 })).rejects.toThrow();
  });
});
