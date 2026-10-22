import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  type BookDetail,
  nameCountsQuery,
  type Shelf,
  saveBookOverrides,
} from "../../api";
import { Chip } from "../../components/Chip/Chip";
import { ChipInput } from "../../components/ChipInput/ChipInput";
import { PlusGlyph, XGlyph } from "../../components/Glyphs/Glyphs";
import { Loading } from "../../components/Loading/Loading";
import { useToast } from "../../components/Toast/Toast";
import { useCurrentUser } from "../../session";
import { type BookDialog, useShelfMembership } from "./BookDialogs";
import { bookQuery, shelvesQuery } from "./queries";
import { heldShelves } from "./shelves";
import { useOptimisticSave } from "./useOptimisticSave";
import "./Overview.css";

type Kind = "genre" | "tag";

const KIND = {
  genre: {
    field: "genres",
    title: "Genres",
    add: "Add genre",
    remove: "Remove genre",
  },
  tag: {
    field: "subjects",
    title: "Tags",
    add: "Add tag",
    remove: "Remove tag",
  },
} as const;

/** Genre and tag edits go straight to the book's overrides, shown at once and put back if the server refuses. */
function useChipSave(book: BookDetail) {
  const toast = useToast();
  return useOptimisticSave(
    bookQuery(book.uuid).queryKey,
    (edit: { genres: string[] } | { subjects: string[] }) =>
      saveBookOverrides(book.uuid, edit),
    {
      optimistic: (edit) => ({ ...book, ...edit }),
      // A smart shelf may match on a tag or a genre, and the filter menus list them.
      alsoInvalidate: [
        shelvesQuery(book.uuid).queryKey,
        nameCountsQuery("tag").queryKey,
        nameCountsQuery("genre").queryKey,
      ],
      onFailure: () => toast("Couldn't save that change"),
    },
  );
}

/** One facts row, its label and what it holds. */
function Fact({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <dt>{title}</dt>
      <dd>{children}</dd>
    </>
  );
}

/** Genres or tags: a chip editor for a reader who may edit the book, plain chips for everyone else. */
function Tags({
  book,
  kind,
  editable,
}: {
  book: BookDetail;
  kind: Kind;
  editable: boolean;
}) {
  const { field, title, add, remove } = KIND[kind];
  const values = field === "genres" ? book.genres : book.subjects;
  const toast = useToast();
  const save = useChipSave(book);
  const suggestions = useQuery({
    ...nameCountsQuery(kind),
    enabled: editable,
  });
  if (!editable) {
    return values.length === 0 ? null : (
      <Fact title={title}>
        <ul className="bp-chips">
          {values.map((value) => (
            <Chip key={value}>{value}</Chip>
          ))}
        </ul>
      </Fact>
    );
  }
  return (
    <Fact title={title}>
      <div className="bp-chips">
        <ChipInput
          label={add}
          values={values}
          suggestions={suggestions.data ?? []}
          placeholder={add}
          removeLabel={remove}
          testId={`bp-add-${kind}`}
          onChange={(next) => {
            const gone = values.find((value) => !next.includes(value));
            if (gone !== undefined) toast(`Removed the ${gone} ${kind}`);
            save.mutate(
              field === "genres" ? { genres: next } : { subjects: next },
            );
          }}
        />
      </div>
    </Fact>
  );
}

/** Whether a held shelf is one the reader may take the book off: hand-picked, and theirs or an admin's to change. */
const canTakeOff = (shelf: Shelf, targets: readonly Shelf[]) =>
  targets.some((target) => target.id === shelf.id);

/** The shelves holding the book, linked, with a × on each hand-picked one, and a chip that opens the picker. */
function Shelves({
  book,
  onOpenDialog,
}: {
  book: BookDetail;
  onOpenDialog: (dialog: BookDialog) => void;
}) {
  const { shelves, facts, viewer, toggle, list } = useShelfMembership(book);
  const addChip = (
    <button
      type="button"
      className="bp-chip-add"
      data-testid="bp-add-to-shelf"
      onClick={() => onOpenDialog("shelf")}
    >
      <PlusGlyph size={14} />
      Add to shelf
    </button>
  );
  if (!facts) {
    return (
      <Fact title="Shelves">
        {shelves.isError ? (
          <p className="bp-quiet" data-testid="bp-shelves-unavailable">
            Your shelves didn’t load — see them on the{" "}
            <Link to="/" className="bp-quiet-link">
              library page →
            </Link>
          </p>
        ) : (
          <Loading
            kind="section"
            className="start"
            label="Checking your shelves"
          />
        )}
      </Fact>
    );
  }
  const held = heldShelves(facts, viewer);
  const targets = list.status === "ready" ? list.targets : [];
  return (
    <Fact title="Shelves">
      {held.length === 0 && <span className="bp-quiet">On no shelves yet</span>}
      {held.length > 0 && (
        <ul className="bp-chips" data-testid="bp-shelves">
          {held.map((shelf) => (
            <Chip key={shelf.id}>
              <Link
                to={`/shelves/${shelf.id}`}
                className="bp-chip-link"
                data-testid={`bp-shelf-${shelf.id}`}
              >
                {shelf.name}
              </Link>
              {shelf.kind === "manual" && canTakeOff(shelf, targets) && (
                <button
                  type="button"
                  className="bp-chip-remove"
                  aria-label={`Take off ${shelf.name}`}
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate({ shelf, adding: false })}
                >
                  <XGlyph size={12} />
                </button>
              )}
            </Chip>
          ))}
        </ul>
      )}
      {addChip}
    </Fact>
  );
}

/** The book's genres, tags and shelves, as the facts under its description. */
export function BookChips({
  book,
  onOpenDialog,
}: {
  book: BookDetail;
  onOpenDialog: (dialog: BookDialog) => void;
}) {
  const viewer = useCurrentUser();
  const editable = viewer.isAdmin || viewer.canEdit;
  return (
    <dl className="bp-facts-list">
      <Tags book={book} kind="genre" editable={editable} />
      <Tags book={book} kind="tag" editable={editable} />
      <Shelves book={book} onOpenDialog={onOpenDialog} />
    </dl>
  );
}
