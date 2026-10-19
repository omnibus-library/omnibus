import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import {
  type AuthorPage,
  authorReadingQuery,
  authorsQuery,
  deleteAuthor,
} from "../../api";
import {
  ConfirmBody,
  ConfirmModal,
} from "../../components/ConfirmModal/ConfirmModal";
import { bookCount } from "../../format";
import { useCurrentUser } from "../../session";
import "../../components/AuthorPhotoEdit/AuthorPhotoEdit.css";
import "../ShelfDetail/ShelfDetail.css";

function DeleteAuthorModal({
  author,
  onClose,
}: {
  author: AuthorPage;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () => deleteAuthor(author.id),
    onSuccess: () => {
      onClose();
      // The list stays mounted across the redirect, so it would never refetch the author away on its own.
      navigate("/authors", { replace: true });
      client.setQueryData(authorsQuery.queryKey, (rows) =>
        rows?.filter((a) => a.id !== author.id),
      );
      client.setQueryData(authorReadingQuery.queryKey, (rows) =>
        rows?.filter((r) => r.authorId !== author.id),
      );
      client.removeQueries({ queryKey: ["author", author.id] });
    },
  });
  const busy = remove.isPending;
  return (
    <ConfirmModal
      testId="author-delete-modal"
      ariaLabel={`Delete ${author.name}`}
      dialogClass="author-delete-modal"
      busy={busy}
      onDismiss={onClose}
      focusOnOpen
    >
      {remove.error && (
        <p role="alert" className="error author-delete-modal__error">
          {`⚠ ${remove.error.message}`}
        </p>
      )}
      <ConfirmBody
        title={`Delete "${author.name}"?`}
        body={`This will un-link the author from ${bookCount(author.bookCount)} and prevent the name from being re-added on future library scans. The books themselves are not deleted.`}
        actions={[
          {
            testId: "author-delete-cancel",
            label: "Cancel",
            tone: "ghost",
            disabled: busy,
            onClick: onClose,
          },
          {
            testId: "author-delete-confirm",
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

/** The ⋯ menu beside "Show in library": an admin's Delete author, and nothing for anyone else. */
export function AuthorMoreMenu({ author }: { author: AuthorPage }) {
  const { isAdmin } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  if (!isAdmin) return null;
  return (
    <>
      <div className="shd-more">
        <button
          type="button"
          className="au-btn au-more-btn"
          aria-label={`More actions for ${author.name}`}
          aria-haspopup="menu"
          aria-expanded={open}
          data-testid="author-more"
          onClick={() => setOpen(!open)}
        >
          ⋯
        </button>
        {open && (
          <>
            {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: a click-away scrim; the menu closes from the keyboard by choosing its item */}
            <div className="shd-menu-scrim" onClick={() => setOpen(false)} />
            <div
              className="shelf-actions-menu shd-menu"
              role="menu"
              aria-label={`More actions for ${author.name}`}
            >
              <button
                type="button"
                className="shelf-menu-item shelf-menu-item--danger shd-menu-item"
                role="menuitem"
                data-testid="author-delete-btn"
                onClick={() => {
                  setOpen(false);
                  setConfirming(true);
                }}
              >
                Delete author…
              </button>
            </div>
          </>
        )}
      </div>
      {confirming && (
        <DeleteAuthorModal
          author={author}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
}
