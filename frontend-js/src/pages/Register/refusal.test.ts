import { describe, expect, it } from "vitest";
import { ApiError } from "../../api";
import { refusalOf } from "./refusal";

describe("refusalOf", () => {
  it.each([
    ["username", "username already taken"],
    ["username", "User already exists"],
    ["password", "Password must be at least 10 characters"],
    ["banner", "Registration is closed"],
  ])("puts the refusal under the %s for %j", (field, message) => {
    expect(refusalOf(new ApiError(400, message)).field).toBe(field);
  });

  it("explains a throttled sign-up instead of echoing the server", () => {
    expect(refusalOf(new ApiError(429, "invalid credentials"))).toEqual({
      field: "banner",
      message: "Too many sign-in attempts. Wait a moment and try again.",
    });
  });
});
