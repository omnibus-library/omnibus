/** The library fields `POST /api/rpc/settings` takes; no interval turns rescans off. */
export type LibrarySettings = {
  ebook_library_path: string;
  audiobook_library_path: string;
  scan_interval_hours?: number;
};

/** The library settings as the server holds them, where none is set yet. */
export type ServerLibrary = {
  ebook_library_path: string | null;
  audiobook_library_path: string | null;
  scan_interval_hours?: number | null;
};

/** What an admin types into the email delivery card. */
export type SmtpSettings = {
  host: string;
  fromEmail: string;
  password: string;
};
