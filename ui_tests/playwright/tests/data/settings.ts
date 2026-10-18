/** The library fields `POST /api/rpc/settings` takes; no interval turns rescans off. */
export type LibrarySettings = {
  ebook_library_path: string;
  audiobook_library_path: string;
  scan_interval_hours?: number;
};

/** What an admin types into the email delivery card. */
export type SmtpSettings = {
  host: string;
  fromEmail: string;
  password: string;
};
