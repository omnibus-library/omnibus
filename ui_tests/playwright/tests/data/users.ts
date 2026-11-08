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
    can_start_requests: boolean;
    can_choose_request_versions: boolean;
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
      can_start_requests: false,
      can_choose_request_versions: false,
    },
  };
}

/** A reader who may also ask for books but not pick their versions. */
export function buildAsker(): NewUser {
  const { permissions, ...reader } = buildReader();
  return {
    ...reader,
    username: reader.username.replace("e2e_reader_", "e2e_asker_"),
    permissions: { ...permissions, can_start_requests: true },
  };
}

/** A user the server holds, with the id its delete call takes. */
export type SeededUser = NewUser & { id: number };

/** A reader who may also upload, for the new-user form's one checked box. */
export function buildUploader(): NewUser {
  const { permissions, ...reader } = buildReader();
  return { ...reader, permissions: { ...permissions, can_upload: true } };
}
