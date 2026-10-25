import { describe, expect, it } from "vitest";
import type { Suggestions } from "../../api";
import {
  SUGGESTION_POLLS,
  suggestionPollMs,
  suggestionsUnavailable,
} from "./queries";

describe("suggestionPollMs", () => {
  it("asks again every 2.5 seconds while the server is still fetching", () => {
    expect(suggestionPollMs({ status: "pending" }, 1)).toBe(2500);
  });

  it("stops after the fifth re-ask", () => {
    expect(suggestionPollMs({ status: "pending" }, SUGGESTION_POLLS)).toBe(
      2500,
    );
    expect(suggestionPollMs({ status: "pending" }, SUGGESTION_POLLS + 1)).toBe(
      false,
    );
  });

  const settled: [string, Suggestions | undefined][] = [
    ["an answer", { status: "ready", items: [] }],
    ["no key", { status: "not_configured" }],
    ["a failed lookup", { status: "unavailable" }],
    ["nothing yet", undefined],
  ];

  it.each(settled)("does not poll for %s", (_case, data) => {
    expect(suggestionPollMs(data, 1)).toBe(false);
  });
});

describe("suggestionsUnavailable", () => {
  const settled: [string, Suggestions | undefined][] = [
    ["an answer", { status: "ready", items: [] }],
    ["no key", { status: "not_configured" }],
    ["nothing yet", undefined],
  ];

  it("is true when the server says the lookup failed", () => {
    expect(suggestionsUnavailable({ status: "unavailable" }, 1)).toBe(true);
  });

  it("is false while a pending answer is still being re-asked for", () => {
    expect(
      suggestionsUnavailable({ status: "pending" }, SUGGESTION_POLLS),
    ).toBe(false);
  });

  it("is true once a pending answer has been asked for as often as it will be", () => {
    expect(
      suggestionsUnavailable({ status: "pending" }, SUGGESTION_POLLS + 1),
    ).toBe(true);
  });

  it.each(settled)("is false for %s", (_case, data) => {
    expect(suggestionsUnavailable(data, SUGGESTION_POLLS + 1)).toBe(false);
  });
});
