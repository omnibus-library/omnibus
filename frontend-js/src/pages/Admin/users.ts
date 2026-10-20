import { z } from "zod";
import type { UserPermissions } from "../../api";

const CREDENTIALS = "Enter a username and password.";

/** The new-user form's credentials, as the inputs name them; the username is sent trimmed, the password as typed. */
export const NewUserSchema = z.object({
  username: z.string().trim().min(1, CREDENTIALS),
  new_password: z.string().min(1, CREDENTIALS),
});

/** The edit form: the row's permissions, and a reset password where blank keeps the current one. */
export const EditUserSchema = z.object({
  permissions: z.object({
    is_admin: z.boolean(),
    can_upload: z.boolean(),
    can_edit: z.boolean(),
    can_download: z.boolean(),
  }) satisfies z.ZodType<UserPermissions>,
  new_password: z.string().trim(),
});

/** A row's permission flags, as the edit form starts them. */
export const permissionsOf = (user: UserPermissions): UserPermissions => ({
  is_admin: user.is_admin,
  can_upload: user.can_upload,
  can_edit: user.can_edit,
  can_download: user.can_download,
});

export const ADMIN_CHIP = "Admin";

/** The chip a row shows when it holds no permission. */
export const NO_PERMISSIONS = "—";

/** A single "Admin" chip for an administrator, else one per granted capability, or a dash when none. */
export function permissionChips(user: UserPermissions): string[] {
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
