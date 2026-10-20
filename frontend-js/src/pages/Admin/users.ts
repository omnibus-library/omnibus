import type { AdminUserRow } from "../../api";

type Permissions = Pick<
  AdminUserRow,
  "is_admin" | "can_upload" | "can_edit" | "can_download"
>;

export const ADMIN_CHIP = "Admin";

/** The chip a row shows when it holds no permission. */
export const NO_PERMISSIONS = "—";

/** A single "Admin" chip for an administrator, else one per granted capability, or a dash when none. */
export function permissionChips(user: Permissions): string[] {
  if (user.is_admin) return [ADMIN_CHIP];
  const chips = [
    user.can_upload && "Upload",
    user.can_edit && "Edit",
    user.can_download && "Download",
  ].filter((chip) => chip !== false);
  return chips.length > 0 ? chips : [NO_PERMISSIONS];
}

/** What the self-registration setting means, in terms of who can create an account; `null` while it loads. */
export function registrationStatusLine(enabled: boolean | null): string {
  if (enabled === null) return "Checking…";
  return enabled
    ? "Anyone who can reach this server can create an account."
    : "Only an administrator can create accounts.";
}
