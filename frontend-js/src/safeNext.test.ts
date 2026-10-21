import { describe, expect, it } from "vitest";
import { loginHref, safeNext } from "./safeNext";

describe("safeNext", () => {
  it.each(["/books/abc", "/settings?section=logs", "/"])(
    "returns the in-app path %s",
    (next) => {
      expect(safeNext(next)).toBe(next);
    },
  );

  it.each([
    ["no next at all", null],
    ["another origin", "https://evil.example/"],
    ["a protocol-relative URL", "//evil.example/"],
    ["a backslash path", "/\\evil.example"],
    ["a relative path", "books/abc"],
    ["a control character", "/books\nabc"],
    ["the sign-in page", "/login?next=/"],
    ["the register page", "/register"],
    ["the connect page", "/connect"],
  ])("refuses %s", (_case, next) => {
    expect(safeNext(next)).toBeNull();
  });
});

describe("loginHref", () => {
  it("carries the page a guest was sent away from", () => {
    expect(loginHref("/books/abc?x=1")).toBe(
      "/login?next=%2Fbooks%2Fabc%3Fx%3D1",
    );
  });

  it("leaves the library out of the link", () => {
    expect(loginHref("/")).toBe("/login");
  });
});
