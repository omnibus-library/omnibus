import { describe, expect, it } from "vitest";
import {
  clearedMessage,
  environmentHint,
  publicUrlDetail,
  publicUrlFieldOf,
  refusalText,
} from "./publicUrl";

const SAVED = { url: "https://books.example.com", source: "settings" } as const;
const FROM_ENV = { url: "https://env.example.com", source: "env" } as const;
const UNSET = { url: null, source: "none" } as const;

describe("publicUrlFieldOf", () => {
  it("fills the field with the URL saved here", () => {
    expect(publicUrlFieldOf(SAVED)).toBe("https://books.example.com");
  });

  it.each([
    ["an environment URL", FROM_ENV],
    ["no URL", UNSET],
    ["a read still out", undefined],
  ])("leaves the field blank for %s", (_condition, status) => {
    expect(publicUrlFieldOf(status)).toBe("");
  });
});

describe("publicUrlDetail", () => {
  it("says a URL was saved here", () => {
    expect(publicUrlDetail(SAVED)).toBe("Saved here");
  });

  it("names the environment variable a URL came from", () => {
    expect(publicUrlDetail(FROM_ENV)).toBe(
      "Set by the server’s environment (OMNIBUS_PUBLIC_URL)",
    );
  });

  it("says nothing before the read lands", () => {
    expect(publicUrlDetail(undefined)).toBe("");
  });
});

describe("environmentHint", () => {
  it("shows the environment's URL as the one in effect", () => {
    expect(environmentHint(FROM_ENV)).toBe(
      "https://env.example.com is in effect, from the server’s environment. A URL saved here takes its place.",
    );
  });

  it.each([
    ["a saved URL", SAVED],
    ["no URL", UNSET],
  ])("has nothing to add for %s", (_condition, status) => {
    expect(environmentHint(status)).toBeNull();
  });
});

describe("clearedMessage", () => {
  it("says the environment's URL is back in effect", () => {
    expect(clearedMessage(FROM_ENV).message).toBe(
      "Saved URL cleared. The server’s environment value is in effect again.",
    );
  });

  it("says notifications go without a link when nothing is left", () => {
    expect(clearedMessage(UNSET)).toEqual({
      message: "Public URL cleared. Notifications send without a link.",
      error: false,
    });
  });
});

describe("refusalText", () => {
  it("names the field the way the card does", () => {
    expect(refusalText("public url must start with http:// or https://")).toBe(
      "The public URL must start with http:// or https://",
    );
  });

  it("opens any other reason as a sentence", () => {
    expect(refusalText("request failed")).toBe("Request failed");
  });
});
