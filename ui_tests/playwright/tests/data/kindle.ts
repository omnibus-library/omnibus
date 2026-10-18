/** Where a Kindle send stands, as the status poll reports it. */
export type KindleSendStatus =
  | { status: "pending" }
  | { status: "sent" }
  | { status: "failed"; message: string };
