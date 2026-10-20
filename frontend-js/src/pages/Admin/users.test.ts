import { describe, expect, it } from "vitest";
import { editIsDirty, permissionChips, registrationStatusLine } from "./users";

const NONE = {
  is_admin: false,
  can_upload: false,
  can_edit: false,
  can_download: false,
};

describe("permissionChips", () => {
  it("returns only Admin for an administrator", () => {
    expect(
      permissionChips({
        is_admin: true,
        can_upload: true,
        can_edit: true,
        can_download: true,
      }),
    ).toEqual(["Admin"]);
  });

  it("returns Admin for an administrator who holds no other flag", () => {
    expect(permissionChips({ ...NONE, is_admin: true })).toEqual(["Admin"]);
  });

  it("returns each granted capability in the table's order", () => {
    expect(
      permissionChips({
        ...NONE,
        can_upload: true,
        can_edit: true,
        can_download: true,
      }),
    ).toEqual(["Upload", "Edit", "Download"]);
  });

  it.each([
    ["can_upload", "Upload"],
    ["can_edit", "Edit"],
    ["can_download", "Download"],
  ] as const)("returns %s alone as %s", (flag, chip) => {
    expect(permissionChips({ ...NONE, [flag]: true })).toEqual([chip]);
  });

  it("returns a dash when nothing is granted", () => {
    expect(permissionChips(NONE)).toEqual(["—"]);
  });
});

describe("editIsDirty", () => {
  const user = {
    is_admin: false,
    can_upload: true,
    can_edit: false,
    can_download: true,
  };

  it("returns false while the permissions and password are untouched", () => {
    expect(editIsDirty(user, { ...user }, "")).toBe(false);
  });

  it("returns true once a password is typed", () => {
    expect(editIsDirty(user, { ...user }, "hunter2hunter2")).toBe(true);
  });

  it.each([
    ["is_admin"],
    ["can_upload"],
    ["can_edit"],
    ["can_download"],
  ] as const)("returns true once %s is flipped", (flag) => {
    expect(editIsDirty(user, { ...user, [flag]: !user[flag] }, "")).toBe(true);
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
