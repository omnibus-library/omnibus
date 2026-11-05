import { describe, expect, it } from "vitest";
import {
  EditUserSchema,
  NewUserSchema,
  permissionChips,
  registrationStatusLine,
} from "./users";

const NONE = {
  is_admin: false,
  can_upload: false,
  can_edit: false,
  can_download: false,
  can_request: false,
};

describe("permissionChips", () => {
  it("returns only Admin for an administrator", () => {
    expect(
      permissionChips(
        {
          is_admin: true,
          can_upload: true,
          can_edit: true,
          can_download: true,
          can_request: true,
        },
        true,
      ),
    ).toEqual(["Admin"]);
  });

  it("returns Admin for an administrator who holds no other flag", () => {
    expect(permissionChips({ ...NONE, is_admin: true }, true)).toEqual([
      "Admin",
    ]);
  });

  it("returns each granted capability in the table's order", () => {
    expect(
      permissionChips(
        {
          ...NONE,
          can_upload: true,
          can_edit: true,
          can_download: true,
          can_request: true,
        },
        true,
      ),
    ).toEqual(["Upload", "Edit", "Download", "Request"]);
  });

  it.each([
    ["can_upload", "Upload"],
    ["can_edit", "Edit"],
    ["can_download", "Download"],
    ["can_request", "Request"],
  ] as const)("returns %s alone as %s", (flag, chip) => {
    expect(permissionChips({ ...NONE, [flag]: true }, true)).toEqual([chip]);
  });

  it("returns a dash when nothing is granted", () => {
    expect(permissionChips(NONE, true)).toEqual(["—"]);
  });

  it("leaves out Request when requests are off", () => {
    expect(
      permissionChips({ ...NONE, can_upload: true, can_request: true }, false),
    ).toEqual(["Upload"]);
  });
});

const CREDENTIALS = "Enter a username and password.";

describe("NewUserSchema", () => {
  describe("validation", () => {
    it.each([
      [
        "a blank username",
        { username: "", new_password: "secret" },
        "username",
      ],
      [
        "a username of spaces",
        { username: "  ", new_password: "secret" },
        "username",
      ],
      [
        "a blank password",
        { username: "carol", new_password: "" },
        "new_password",
      ],
    ])("refuses %s", (_condition, fields, field) => {
      expect(NewUserSchema.safeParse(fields).error?.issues).toEqual([
        expect.objectContaining({ path: [field], message: CREDENTIALS }),
      ]);
    });
  });

  it("trims the username but sends the password as typed", () => {
    expect(
      NewUserSchema.parse({ username: " carol ", new_password: " pass " }),
    ).toEqual({ username: "carol", new_password: " pass " });
  });
});

describe("EditUserSchema", () => {
  it("trims the reset password", () => {
    expect(
      EditUserSchema.parse({ permissions: NONE, new_password: " pass " }),
    ).toEqual({ permissions: NONE, new_password: "pass" });
  });

  it("reads a password of spaces as none", () => {
    expect(
      EditUserSchema.parse({ permissions: NONE, new_password: "   " })
        .new_password,
    ).toBe("");
  });
});

describe("registrationStatusLine", () => {
  it.each([
    [true, "Anyone who can reach this server can create an account."],
    [false, "Only an administrator can create accounts."],
    [null, "Checking…"],
  ])("describes %s", (enabled, line) => {
    expect(registrationStatusLine(enabled)).toBe(line);
  });
});
