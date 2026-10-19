import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import {
  deleteShelf,
  invalidateShelf,
  type ShelfDetail,
  updateShelf,
} from "../../api";
import {
  ConfirmBody,
  ConfirmModal,
} from "../../components/ConfirmModal/ConfirmModal";
import {
  LockGlyph,
  PencilGlyph,
  PeopleGlyph,
  PlusGlyph,
} from "../../components/Glyphs/Glyphs";
import { MoreMenu } from "../../components/MoreMenu/MoreMenu";
import {
  kindLabel,
  ruleText,
  visibilityLabel,
} from "../../components/ShelfForm/rules";
import { KindGlyph } from "../../components/ShelfTile/ShelfTile";
import { UserAvatar } from "../../components/UserAvatar/UserAvatar";
import { bookCount } from "../../format";
import type { FullList } from "./narrow";
import {
  addBooksState,
  canEdit,
  lockDetail,
  lockHeadline,
  type ShelfAccess,
} from "./shelfAccess";
import "../../components/ShelfForm/ShelfForm.css";
import "./ShelfDetail.css";

/** The id of the lock note every greyed-out action points at. */
const LOCK_NOTE_ID = "shd-lock-reason";

function Kicker({ shelf }: { shelf: ShelfDetail }) {
  return (
    <div className="shd-kicker" data-testid="shelf-kicker">
      <span className="shd-kicker-item shd-kicker-item--kind">
        <KindGlyph kind={shelf.kind} />
        {kindLabel(shelf.kind)}
      </span>
      <span className="shd-kicker-item">
        {shelf.visibility === "private" ? <LockGlyph /> : <PeopleGlyph />}
        {visibilityLabel(shelf.visibility)}
      </span>
      <span className="shd-kicker-item">{bookCount(shelf.bookCount)}</span>
    </div>
  );
}

function OwnerLine({
  shelf,
  access,
}: {
  shelf: ShelfDetail;
  access: ShelfAccess;
}) {
  const own =
    access.kind === "owner" ||
    (access.kind === "locked" &&
      access.reason.why === "wishlist" &&
      access.reason.own);
  return (
    <div className="shd-owner" data-testid="shelf-owner">
      <span className="shd-owner-av" aria-hidden="true">
        <UserAvatar
          user={shelf.owner}
          className="shv-av"
          photoClassName="shv-av-photo"
        />
      </span>
      {own ? (
        <span className="shd-owner-name">Your shelf</span>
      ) : (
        <>
          <span className="shd-owner-lead">Owned by</span>
          <span className="shd-owner-name" data-testid="shelf-owner-name">
            {shelf.owner.name}
          </span>
        </>
      )}
    </div>
  );
}

function RulesRow({ shelf }: { shelf: ShelfDetail }) {
  if (shelf.kind !== "smart" || shelf.rules.length === 0) return null;
  return (
    <div className="shd-rules" data-testid="shelf-rules">
      <span className="shd-rules-lead">
        {shelf.matchMode === "any"
          ? "Books matching any of"
          : "Books matching all of"}
      </span>
      {shelf.rules.map((rule, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: two rules can read alike
        <span key={i} className="shelf-rule-chip">
          {ruleText(rule)}
        </span>
      ))}
    </div>
  );
}

function DeleteShelfModal({
  shelf,
  onClose,
}: {
  shelf: ShelfDetail;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () => deleteShelf(shelf.id),
    onSuccess: () => {
      navigate("/shelves");
      client.invalidateQueries({ queryKey: ["shelves"] });
      // The shelf is gone: a refetch would only be a 404.
      client.removeQueries({ queryKey: ["shelf", shelf.id] });
      client.removeQueries({ queryKey: ["shelf-page", shelf.id] });
    },
  });
  const busy = remove.isPending;
  return (
    <ConfirmModal
      testId="shelf-delete-modal"
      ariaLabel="Delete shelf?"
      dialogClass="mg-modal confirm-modal"
      busy={busy}
      onDismiss={onClose}
      focusOnOpen
    >
      <ConfirmBody
        title="Delete shelf?"
        body={`Deleting “${shelf.name}” removes the shelf. Its books stay in your library. This can’t be undone.`}
        note={
          remove.error && (
            <p
              role="alert"
              className="shelf-modal-error"
              data-testid="shelf-delete-error"
            >
              {`Couldn’t delete this shelf: ${remove.error.message}`}
            </p>
          )
        }
        actions={[
          {
            testId: "shelf-delete-cancel",
            label: "Cancel",
            tone: "ghost",
            disabled: busy,
            onClick: onClose,
          },
          {
            testId: "shelf-delete-confirm",
            label: "Delete",
            busyLabel: "Deleting…",
            busy,
            tone: "danger",
            disabled: busy,
            onClick: () => remove.mutate(),
          },
        ]}
      />
    </ConfirmModal>
  );
}

type ActionsProps = {
  shelf: ShelfDetail;
  access: ShelfAccess;
  /** Add books waits on the member list, which marks what the shelf already holds. */
  full: FullList;
  onAdd: () => void;
  onEdit: () => void;
};

/** Add books, Edit shelf and ⋯: each stays put but greyed and inert, described by the lock note, when the viewer can't edit. */
function ShelfActions({ shelf, access, full, onAdd, onEdit }: ActionsProps) {
  const client = useQueryClient();
  // Lives here, not in the menu, which unmounts on choosing an item.
  const toggle = useMutation({
    mutationFn: () =>
      updateShelf(shelf.id, { sync_to_kobo: !shelf.syncToKobo }),
    onSuccess: () => invalidateShelf(client, shelf.id),
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const editable = canEdit(access);
  const lock = access.kind === "locked" ? access.reason : null;
  const tip = lock ? lockHeadline(lock) : undefined;
  const describedBy = lock ? LOCK_NOTE_ID : undefined;
  const manual = shelf.kind === "manual";
  const add = addBooksState(editable, full);
  const canAdd = add?.ready ?? false;
  // A lock outranks "still loading".
  const addTip = add?.title ?? tip;
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and min-width the hero never resets */}
      <div className="shd-actions" role="group" aria-label="Shelf actions">
        {manual && (
          <button
            type="button"
            className="btn primary shd-action"
            data-testid="shelf-add-books"
            aria-disabled={!canAdd}
            aria-describedby={describedBy}
            title={addTip}
            onClick={() => canAdd && onAdd()}
          >
            <PlusGlyph />
            Add books
          </button>
        )}
        <button
          type="button"
          className={manual ? "btn shd-action" : "btn primary shd-action"}
          data-testid="shelf-edit"
          aria-disabled={!editable}
          aria-describedby={describedBy}
          title={tip}
          onClick={() => editable && onEdit()}
        >
          <PencilGlyph />
          Edit shelf
        </button>
        <div className="shd-more">
          <button
            type="button"
            className="btn shd-action shd-more-btn"
            data-testid="shelf-actions"
            aria-label="More shelf actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-disabled={!editable}
            aria-describedby={describedBy}
            title={tip}
            onClick={() => editable && setMenuOpen(!menuOpen)}
          >
            ⋯
          </button>
          {editable && menuOpen && (
            <MoreMenu
              label="More shelf actions"
              onClose={() => setMenuOpen(false)}
              items={[
                {
                  label: "Sync to Kobo",
                  testId: "shelf-toggle-kobo",
                  checked: shelf.syncToKobo,
                  disabled: toggle.isPending,
                  onSelect: () => toggle.mutate(),
                },
                {
                  label: "Delete shelf",
                  testId: "shelf-delete",
                  danger: true,
                  onSelect: () => setDeleting(true),
                },
              ]}
            />
          )}
        </div>
      </div>
      {toggle.error && (
        <p
          role="alert"
          className="error shd-alert"
          data-testid="shelf-kobo-error"
        >
          {`Couldn’t change Kobo sync: ${toggle.error.message}`}
        </p>
      )}
      {deleting && (
        <DeleteShelfModal shelf={shelf} onClose={() => setDeleting(false)} />
      )}
    </>
  );
}

function AccessNote({ access }: { access: ShelfAccess }) {
  // A note earns its place by explaining a refusal; the hero already names the owner.
  if (access.kind !== "locked") return null;
  return (
    <div
      className="shd-note shd-note--locked"
      id={LOCK_NOTE_ID}
      role="note"
      data-testid="shelf-lock-reason"
    >
      <span className="shd-note-icon" aria-hidden="true">
        <LockGlyph />
      </span>
      <div className="shd-note-text">
        <strong>{lockHeadline(access.reason)}</strong>
        <span>{lockDetail(access.reason)}</span>
      </div>
    </div>
  );
}

/** Kind, visibility and size, whose shelf it is, its description and rules, and the action bar. */
export function ShelfHero(props: ActionsProps) {
  const { shelf, access } = props;
  const description = shelf.description?.trim() ? shelf.description : null;
  return (
    <header className="shd-hero" data-testid="shelf-detail-header">
      <div className="shd-hero-main">
        <Kicker shelf={shelf} />
        <h1 className="shd-title">{shelf.name}</h1>
        <OwnerLine shelf={shelf} access={access} />
        {description && <p className="shd-desc">{description}</p>}
        <RulesRow shelf={shelf} />
        {shelf.syncToKobo && (
          <span
            className="shelf-badge shelf-badge--kobo shd-kobo"
            data-testid="shelf-kobo-badge"
          >
            Syncs to Kobo
          </span>
        )}
      </div>
      <ShelfActions {...props} />
      <AccessNote access={access} />
    </header>
  );
}
