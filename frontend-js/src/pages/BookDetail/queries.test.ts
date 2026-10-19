import { describe, expect, it } from "vitest";
import type { Suggestions } from "../../api";
import { SUGGESTION_POLLS, suggestionPollMs } from "./queries";

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
    ["nothing yet", undefined],
  ];

  it.each(settled)("does not poll for %s", (_case, data) => {
    expect(suggestionPollMs(data, 1)).toBe(false);
  });
});
