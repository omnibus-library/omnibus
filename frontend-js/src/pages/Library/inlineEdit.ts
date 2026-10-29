import {
  type QueryKey,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  type Book,
  type MetadataOverrides,
  nameCountsQuery,
  saveBookOverrides,
} from "../../api";
import { useToast } from "../../components/Toast/Toast";
import type { ChipField, TextField } from "./EditableCell";

export type EditField = TextField | ChipField;

/** What an empty string means for a scalar: no value. */
const text = (edit: string | null | undefined, current: string | null) =>
  edit == null ? current : edit || null;

/** The book as `edit` leaves it, shown until the server answers. */
export function applyEdit(book: Book, edit: MetadataOverrides): Book {
  let series = book.series;
  if (edit.series != null) {
    series = edit.series
      ? { name: edit.series, index: book.series?.index ?? null }
      : null;
  }
  return {
    ...book,
    title: edit.title || book.title,
    authors: edit.creators?.map((c) => c.name) ?? book.authors,
    series,
    subjects: edit.subjects ?? book.subjects,
    genres: edit.genres ?? book.genres,
    published: text(edit.published, book.published),
    language: text(edit.language, book.language),
  };
}

// The filter menus list every author, tag and genre, so a list edit makes them stale.
const NAME_LISTS = [
  ["creators", "author"],
  ["subjects", "tag"],
  ["genres", "genre"],
] as const;

type Write = { edit: MetadataOverrides; id: number };

/**
 * One table row's inline edits: the open cell, and the row as the newest write leaves it,
 * shown at once and replaced by the server's answer. Writes for the row run in the order made.
 */
export function useRowEdit(book: Book) {
  const client = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<EditField | null>(null);
  const [shown, setShown] = useState<Book | null>(null);
  const newest = useRef(0);
  // The newest answer the server gave, which a refused write falls back to while the list may still predate it.
  const lastSaved = useRef<Book | null>(null);
  const view = shown ?? book;
  const mutationKey = ["row-edit", book.uuid];

  // A refetch that lands with nothing in flight is the truth again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when a new `book` arrives, which the body does not read
  useEffect(() => {
    if (client.isMutating({ mutationKey }) > 0) return;
    lastSaved.current = null;
    setShown(null);
  }, [book]);

  const write = useMutation({
    mutationKey,
    scope: { id: book.uuid },
    mutationFn: ({ edit }: Write) => saveBookOverrides(book.uuid, edit),
    onSuccess: (saved, { edit, id }) => {
      // The book's page, the lists and the resume row all read what an edit changes.
      const stale: QueryKey[] = [
        ["book", book.uuid],
        ["books"],
        ["shelf-page"],
        ["shelves"],
        ["progress", "recent"],
        ...NAME_LISTS.filter(([key]) => edit[key] != null).map(
          ([, field]) => nameCountsQuery(field).queryKey,
        ),
      ];
      for (const queryKey of stale) {
        void client.invalidateQueries({ queryKey });
      }
      lastSaved.current = saved;
      if (id === newest.current) setShown(saved);
    },
    onError: (error, { id }) => {
      toast(`Couldn’t save the change to “${book.title}”: ${error.message}`);
      if (id !== newest.current) return;
      setShown(lastSaved.current);
      void client.invalidateQueries({ queryKey: ["books"] });
    },
  });

  const save = (edit: MetadataOverrides) => {
    const id = ++newest.current;
    setShown((current) => applyEdit(current ?? book, edit));
    write.mutate({ edit, id });
  };

  return { view, editing, setEditing, save };
}
