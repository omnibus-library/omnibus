import { z } from "zod";
import type { BookUuid, UserId } from "./core";
import { ok, send } from "./core";
import {
  getDeleteJournalUrl,
  getJournalEntries,
  getPostJournalPreviewUrl,
  patchJournal,
  postJournal,
  postJournalImage,
} from "./generated/omnibus";
import type { JournalEntryOutput as JournalEntryWire } from "./generated/schemas";

/** The screen's shape of one journal entry. */
export function toJournalEntry(wire: JournalEntryWire) {
  return {
    id: wire.id,
    author: {
      id: wire.author_id as UserId,
      name: wire.author_name,
      hasAvatar: wire.author_has_avatar ?? false,
    },
    bodyMd: wire.body_md,
    bodyHtml: wire.body_html,
    progress: wire.progress ?? null,
    status: wire.status ?? "published",
    createdAt: wire.created_at,
  };
}

export type JournalEntry = ReturnType<typeof toJournalEntry>;

/** Every reader's published entries for a book, and the signed-in reader's own drafts. */
export async function fetchJournalEntries(
  uuid: BookUuid,
): Promise<JournalEntry[]> {
  return ok(await getJournalEntries(encodeURIComponent(uuid))).map(
    toJournalEntry,
  );
}

type JournalDraft = {
  bodyMd: string;
  progress: number | null;
  status?: "draft" | "published";
};

/** Writes a new entry about a book; a `draft` stays visible to its author only. */
export async function createJournalEntry(
  uuid: BookUuid,
  { bodyMd, progress, status }: JournalDraft,
): Promise<JournalEntry> {
  return toJournalEntry(
    ok(
      await postJournal({
        book_uuid: uuid,
        body_md: bodyMd,
        progress,
        status,
      }),
    ),
  );
}

/** Rewrites an entry's body and progress; a `status` publishes or reverts it, none keeps it. */
export async function updateJournalEntry(
  id: number,
  { bodyMd, progress, status }: JournalDraft,
): Promise<JournalEntry> {
  return toJournalEntry(
    ok(
      await patchJournal(String(id), {
        body_md: bodyMd,
        progress,
        status,
      }),
    ),
  );
}

/** Publishes a draft, keeping its body and progress. */
export const publishJournalEntry = ({ id, bodyMd, progress }: JournalEntry) =>
  updateJournalEntry(id, { bodyMd, progress, status: "published" });

/** The server's sanitised HTML for markdown, as a saved entry would render it. */
export async function previewJournal(bodyMd: string): Promise<string> {
  // The generated fetcher would JSON-parse a 400's plain-text body.
  const res = await send(getPostJournalPreviewUrl(), "POST", bodyMd);
  return z.string().parse(await res.json());
}

/** Stores an image for a journal entry and returns the URL to embed it by. */
export async function uploadJournalImage(image: File): Promise<string> {
  return ok(await postJournalImage({ image })).url;
}

export async function deleteJournalEntry(id: number): Promise<void> {
  await send(getDeleteJournalUrl(String(id)), "DELETE");
}
