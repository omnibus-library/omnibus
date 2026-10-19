import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import {
  fetchShelfPage,
  invalidateShelf,
  type LibraryQuery,
  shelfQuery,
} from "../../api";
import { AddBooksModal } from "../../components/AddBooksModal/AddBooksModal";
import { Loading } from "../../components/Loading/Loading";
import { PageError } from "../../components/PageState/PageState";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { EditShelfModal } from "../../components/ShelfForm/EditShelfModal";
import { useCurrentUser } from "../../session";
import { ShelfHero } from "./ShelfHero";
import { resolveAccess } from "./shelfAccess";
import "./ShelfDetail.css";

// The whole member list, in the server's default order.
const WHOLE_SHELF: Pick<LibraryQuery, "sort" | "dir" | "clauses"> = {
  sort: "recently_interacted",
  dir: "desc",
  clauses: [],
};

/** The way back to the index, above every state of the page. */
function BackCrumb() {
  return (
    <nav className="shd-crumbs" aria-label="Breadcrumb">
      <Link to="/shelves" className="shd-back" data-testid="shelf-back">
        ← All shelves
      </Link>
    </nav>
  );
}

function PageState({ children }: { children: React.ReactNode }) {
  return (
    <div className="shd-page">
      <BackCrumb />
      <div className="shd-state">{children}</div>
    </div>
  );
}

/** `/shelves/:id`: the shelf's hero and actions, and the books on it. */
export function ShelfDetail() {
  const id = Number(useParams().id);
  const viewer = useCurrentUser();
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const shelf = useQuery({ ...shelfQuery(id), enabled: Number.isInteger(id) });
  // What Add books marks as already on the shelf.
  const members = useQuery({
    queryKey: ["shelf-page", id, WHOLE_SHELF],
    queryFn: () => fetchShelfPage(id, WHOLE_SHELF),
    enabled: shelf.data != null,
  });

  if (!shelf.data) {
    return (
      <PageState>
        {shelf.isError ? (
          <PageError
            message={shelf.error.message}
            backTo="/shelves"
            backLabel="Back to shelves"
          />
        ) : shelf.data === null || !Number.isInteger(id) ? (
          <PageError
            message="Shelf not found."
            backTo="/shelves"
            backLabel="Back to shelves"
          />
        ) : (
          <Loading kind="page" label="Opening the shelf" />
        )}
      </PageState>
    );
  }

  const current = shelf.data;
  const access = resolveAccess(viewer, current);
  return (
    <div
      className="shd-page"
      style={{ "--shelf-accent": current.accent ?? "var(--accent)" }}
      data-testid="shelf-detail"
    >
      <PageTitle page={current.name} />
      <BackCrumb />
      <ShelfHero
        shelf={current}
        access={access}
        membersReady={members.isSuccess}
        onAdd={() => setAdding(true)}
        onEdit={() => setEditing(true)}
      />
      {adding && (
        <AddBooksModal
          shelfId={id}
          shelfName={current.name}
          members={(members.data ?? []).map((b) => b.uuid)}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            invalidateShelf(client, id);
          }}
        />
      )}
      {editing && (
        <EditShelfModal
          shelf={current}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            invalidateShelf(client, id);
          }}
        />
      )}
    </div>
  );
}
