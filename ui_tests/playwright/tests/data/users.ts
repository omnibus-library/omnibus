import { uniqueSuffix } from "./unique";

/** A username and password to sign in with. */
export type Credentials = { username: string; password: string };

/** The body `POST /api/admin/users` takes. */
export type NewUser = Credentials & {
  permissions: {
    is_admin: boolean;
    can_upload: boolean;
    can_edit: boolean;
    can_download: boolean;
  };
};

/** A plain reader who may download but not upload, edit or administer. */
export function buildReader(): NewUser {
  return {
    username: `e2e_reader_${uniqueSuffix().replaceAll("-", "_")}`,
    password: "e2e-reader-pw-01",
    permissions: {
      is_admin: false,
      can_upload: false,
      can_edit: false,
      can_download: true,
    },
  };
}
