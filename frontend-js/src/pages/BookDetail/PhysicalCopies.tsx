import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import {
  addToWishlist,
  type BookDetail,
  type BookUuid,
  deleteCopy,
  deleteFilelessBook,
  type PhysicalCopy,
  removeFromWishlist,
  saveCopyNote,
} from "../../api";
import { Button, ButtonLink } from "../../components/Button/Button";
import {
  ConfirmBody,
  ConfirmDialog,
  ConfirmModal,
} from "../../components/ConfirmModal/ConfirmModal";
import { BookGlyph } from "../../components/Glyphs/Glyphs";
import { ago, nowSecs, wishlistSource } from "../../format";
import { useCurrentUser } from "../../session";
import {
  bookQuery,
  copiesQuery,
  shelvesQuery,
  useLeaveBook,
  wishlistQuery,
} from "./queries";

/** An Amazon search on the ISBN, or on title and author when the book has none. */
function findCopyUrl(book: BookDetail) {
  const query = book.isbn13?.trim() || `${book.title} ${book.authors[0] ?? ""}`;
  return `https://www.amazon.com/s?k=${encodeURIComponent(query.trim())}`;
}

// A wishlist or copy write changes the record (`hasPhysical`, visibility), the copies, the wish
// and the shelf facts, but nothing else on the page.
function refreshAround(client: QueryClient, uuid: BookUuid) {
  return Promise.all([
    client.invalidateQueries({
      queryKey: bookQuery(uuid).queryKey,
      exact: true,
    }),
    ...[copiesQuery, wishlistQuery, shelvesQuery].map((query) =>
      client.invalidateQueries({ queryKey: query(uuid).queryKey }),
    ),
  ]);
}

function useWishlistWrites(uuid: BookUuid) {
  const client = useQueryClient();
  const leave = useLeaveBook(uuid);
  const refresh = () => refreshAround(client, uuid);
  const add = useMutation({
    mutationFn: () => addToWishlist(uuid),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => removeFromWishlist(uuid),
    onSuccess: ({ bookDeleted }) => {
      // A wishlist-only book nobody else wants went with the entry.
      return bookDeleted ? leave() : refresh();
    },
  });
  return { add, remove };
}

const WishlistError = ({ message }: { message: string }) => (
  <p role="alert" className="bd-phys-error" data-testid="wishlist-error">
    {message}
  </p>
);

/** The Home buttons of a wishlist-only book: find it, check it in once it arrives, or give up on it. */
export function WishlistCtas({ book }: { book: BookDetail }) {
  const { remove } = useWishlistWrites(book.uuid);
  return (
    <>
      <div className="bdmq-ctarow">
        <a
          className="btn primary lg"
          data-testid="find-a-copy"
          href={findCopyUrl(book)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Find a copy
        </a>
        <ButtonLink
          size="lg"
          to={
            book.isbn13
              ? `/check-in?isbn=${encodeURIComponent(book.isbn13)}`
              : "/check-in"
          }
          state={{ fromApp: true }}
          data-testid="wishlist-check-in"
        >
          Check in when acquired
        </ButtonLink>
        <Button
          variant="ghost"
          size="lg"
          className="bdmq-danger"
          data-testid="wishlist-remove"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          Remove from wishlist
        </Button>
      </div>
      {remove.isError && <WishlistError message={remove.error.message} />}
    </>
  );
}

/** The wishlist as a dashed row among the copies: tracked, untracked, or nothing for a book already held. */
export function WishlistRow({ book }: { book: BookDetail }) {
  const wishlist = useQuery(wishlistQuery(book.uuid));
  const { add, remove } = useWishlistWrites(book.uuid);
  if (!wishlist.isSuccess) return null;
  const entry = wishlist.data;
  if (!entry && book.hasPhysical) return null;
  return (
    <>
      <div
        className="rx-copy wish"
        data-testid={entry ? "wishlist-card" : "wishlist-add-card"}
      >
        <span
          role="img"
          className="format-badge rx-ic"
          data-testid={entry ? "format-badge-wishlist" : undefined}
          title="On your physical wishlist"
          aria-label="Physical Wishlist"
        >
          <BookGlyph size={15} />
        </span>
        <div className="rx-copy-body">
          <div className="nm">Print wishlist</div>
          <div className="sb">
            {entry
              ? `Tracking since ${ago(nowSecs(), entry.addedAt)} · added from ${wishlistSource(entry.source)}`
              : "Track this title to find a physical copy later."}
          </div>
        </div>
        <div className="format-actions">
          {entry ? (
            <>
              <a
                className="btn sm"
                data-testid="find-a-copy"
                href={findCopyUrl(book)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Find a copy
              </a>
              <Button
                variant="ghost"
                size="sm"
                data-testid="wishlist-remove"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                Remove from wishlist
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              data-testid="add-to-wishlist"
              disabled={add.isPending}
              onClick={() => add.mutate()}
            >
              Add to physical wishlist
            </Button>
          )}
        </div>
      </div>
      {(add.isError || remove.isError) && (
        <WishlistError message={(add.error ?? remove.error)?.message ?? ""} />
      )}
    </>
  );
}

function NoteEditor({
  copy,
  uuid,
  onDone,
}: {
  copy: PhysicalCopy;
  uuid: BookUuid;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState(copy.note ?? "");
  const save = useMutation({
    mutationFn: () => saveCopyNote(copy.id, draft.trim()),
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: copiesQuery(uuid).queryKey,
      });
      onDone();
    },
  });
  return (
    <div className="rx-copy-editor">
      <div className="bd-phys-note-editor">
        <label className="label" htmlFor={`copy-note-${copy.id}`}>
          Edition note
        </label>
        <textarea
          id={`copy-note-${copy.id}`}
          className="bd-phys-note-input"
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <div className="bd-phys-note-actions">
          <Button
            size="sm"
            data-testid="copy-note-save"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
          <Button
            variant="ghost"
            size="sm"
            data-testid="copy-note-cancel"
            onClick={onDone}
          >
            Cancel
          </Button>
        </div>
        {save.isError && (
          <p role="alert" className="bd-phys-error">
            {save.error.message}
          </p>
        )}
      </div>
    </div>
  );
}

type Next = "nothing" | "wishlist" | "library";

type CopyRowProps = {
  copy: PhysicalCopy;
  mayChange: boolean;
  editing: boolean;
  viewerId: number;
  onEdit: () => void;
  onEdited: () => void;
  onRemove: () => void;
  uuid: BookUuid;
};

/** Whose physical collection the copy sits in: yours, the reader who filed it, or the household's once the filer is gone. */
const collectionLabel = (copy: PhysicalCopy, viewerId: number) =>
  copy.filerId === viewerId
    ? "In your physical collection"
    : copy.filerName
      ? `In ${copy.filerName}'s physical collection`
      : "In the household's physical collection";

function CopyRow({
  copy,
  mayChange,
  editing,
  viewerId,
  onEdit,
  onEdited,
  onRemove,
  uuid,
}: CopyRowProps) {
  const filer = copy.filerId === viewerId ? "you" : copy.filerName;
  const collection = collectionLabel(copy, viewerId);
  const when = ago(nowSecs(), copy.checkedInAt);
  const hasNote = Boolean(copy.note?.trim());
  return (
    <div className="rx-copy" data-testid="physical-copy-card">
      <span
        role="img"
        className="format-badge rx-ic"
        data-testid="format-badge-physical"
        title={collection}
        aria-label="Physical"
      >
        <BookGlyph size={15} />
      </span>
      <div className="rx-copy-body">
        <div className="nm">Physical copy</div>
        <div className="sb">
          <span
            role="img"
            className="rx-statusdot"
            data-testid="physical-pill"
            aria-label={collection}
          />
          {filer ? `Checked in ${when} by ${filer}` : `Checked in ${when}`}
          {copy.isbn && (
            <>
              <br />
              ISBN {copy.isbn}
            </>
          )}
        </div>
        {hasNote && !editing && (
          <p className="bd-phys-copy-note">{copy.note}</p>
        )}
      </div>
      {editing ? (
        <NoteEditor copy={copy} uuid={uuid} onDone={onEdited} />
      ) : (
        mayChange && (
          <div className="format-actions">
            <Button
              variant="ghost"
              size="sm"
              data-testid="copy-edit-note"
              onClick={onEdit}
            >
              {hasNote ? "Edit note" : "Add a note"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="bd-phys-danger"
              data-testid="copy-delete"
              onClick={onRemove}
            >
              Remove…
            </Button>
          </div>
        )
      )}
    </div>
  );
}

type RemovalProps = {
  lastFileless: boolean;
  mayRemoveBook: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onRemove: (next: Next) => void;
};

function RemovalDialog({
  lastFileless,
  mayRemoveBook,
  busy,
  error,
  onCancel,
  onRemove,
}: RemovalProps) {
  const note = error && (
    <p className="bd-merge-error" role="alert">
      {error}
    </p>
  );
  if (!lastFileless) {
    return (
      <ConfirmDialog
        testId="copy-delete-modal"
        title="Remove this copy?"
        body="This removes the physical copy from your collection."
        action="I sold it"
        busyLabel="Removing…"
        busy={busy}
        note={note}
        onCancel={onCancel}
        onConfirm={() => onRemove("nothing")}
      />
    );
  }
  const title = "Remove your last copy";
  const lead = "This is the only copy of a book with no files in your library.";
  return (
    <ConfirmModal
      testId="last-copy-modal"
      ariaLabel={title}
      // Wider than its two-button siblings: three actions don't fit 440px.
      dialogClass="mg-modal del-modal"
      busy={busy}
      onDismiss={onCancel}
      focusOnOpen
    >
      <ConfirmBody
        title={title}
        body={
          mayRemoveBook
            ? `${lead} Remove it entirely, or keep tracking it on your wishlist?`
            : `${lead} Keep tracking it on your wishlist instead?`
        }
        note={note}
        actions={[
          {
            testId: "last-copy-cancel",
            label: "Cancel",
            tone: "ghost",
            disabled: busy,
            onClick: onCancel,
          },
          {
            testId: "last-copy-wishlist",
            label: "Move to wishlist",
            tone: "ghost",
            disabled: busy,
            onClick: () => onRemove("wishlist"),
          },
          ...(mayRemoveBook
            ? [
                {
                  testId: "last-copy-remove",
                  label: "Remove from library",
                  tone: "danger" as const,
                  disabled: busy,
                  onClick: () => onRemove("library"),
                },
              ]
            : []),
        ]}
      />
    </ConfirmModal>
  );
}

/** The book's checked-in copies, one row each; a note and Remove belong to the filer or an admin. */
export function PhysicalCopies({ book }: { book: BookDetail }) {
  const client = useQueryClient();
  const viewer = useCurrentUser();
  const copies = useQuery(copiesQuery(book.uuid));
  const [editing, setEditing] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  const refresh = () => refreshAround(client, book.uuid);
  const leave = useLeaveBook(book.uuid);
  const mayRemoveBook = viewer.isAdmin || viewer.canEdit;
  // The copy is gone whatever follows, so a failed follow-up leaves a retryable page.
  const followUp = useMutation({
    mutationFn: async (next: "wishlist" | "library") => {
      await (next === "wishlist"
        ? addToWishlist(book.uuid)
        : deleteFilelessBook(book.uuid));
    },
    onSuccess: (_done, next) => (next === "library" ? leave() : refresh()),
    onError: refresh,
  });
  const removeCopy = useMutation({
    mutationFn: ({ copyId }: { copyId: number; next: Next }) =>
      deleteCopy(copyId),
    onSuccess: (_done, { next }) => {
      setRemoving(null);
      if (next === "nothing") refresh();
      else followUp.mutate(next);
    },
    // The copy may be gone even so: let the page say what is left.
    onError: refresh,
  });
  const failure = followUp.error ?? removeCopy.error;
  if (copies.isPending) return null;
  const list = copies.data ?? [];
  if (list.length === 0 && !copies.isError && !failure) return null;
  const lastFileless = book.formats.length === 0 && list.length === 1;
  return (
    <section
      className="bd-physical-panel bd-physical-panel-marquee"
      data-testid="bd-physical-panel"
    >
      {list.map((copy) => (
        <CopyRow
          key={copy.id}
          copy={copy}
          uuid={book.uuid}
          viewerId={viewer.id}
          mayChange={copy.filerId === viewer.id || viewer.isAdmin}
          editing={editing === copy.id}
          onEdit={() => setEditing(copy.id)}
          onEdited={() => setEditing(null)}
          onRemove={() => {
            removeCopy.reset();
            followUp.reset();
            setRemoving(copy.id);
          }}
        />
      ))}
      {copies.isError && (
        <p role="alert" className="bd-phys-error" data-testid="physical-error">
          {copies.error.message}
        </p>
      )}
      {failure && removing === null && (
        <p role="alert" className="bd-phys-error" data-testid="physical-error">
          {failure.message}
        </p>
      )}
      {followUp.isError &&
        followUp.variables === "library" &&
        mayRemoveBook && (
          <Button variant="ghost" onClick={() => followUp.mutate("library")}>
            Retry removing from library
          </Button>
        )}
      {removing !== null && (
        <RemovalDialog
          lastFileless={lastFileless}
          mayRemoveBook={mayRemoveBook}
          busy={removeCopy.isPending || followUp.isPending}
          error={removeCopy.error?.message ?? null}
          onCancel={() => setRemoving(null)}
          onRemove={(next) => removeCopy.mutate({ copyId: removing, next })}
        />
      )}
    </section>
  );
}
