import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { shelvesQuery } from "../../api";
import { LockGlyph } from "../../components/Glyphs/Glyphs";
import { Loading } from "../../components/Loading/Loading";
import { PageError } from "../../components/PageState/PageState";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { CreateShelfModal } from "../../components/ShelfForm/CreateShelfModal";
import {
  accentStyle,
  ShelfTileFace,
} from "../../components/ShelfTile/ShelfTile";
import { UserAvatar } from "../../components/UserAvatar/UserAvatar";
import { useCurrentUser } from "../../session";
import { loadDiscoveryPrefs, saveDiscoverySort } from "../../viewPrefs";
import {
  census,
  emptyMessage,
  groupShelves,
  groupTitle,
  isFiltering,
  KINDS,
  owners,
  type ShelfQuery,
  type ShelvesSort,
  showsOthersPrivate,
} from "./shelvesIndex";
import "../../components/Chip/Chip.css";
import "../../components/DiscPage/DiscPage.css";
import "./Shelves.css";

const SORTS = [
  ["name", "A–Z", "shelves-sort-name"],
  ["book_count", "Most books", "shelves-sort-count"],
] as const satisfies readonly [ShelvesSort, string, string][];

/** `/shelves`: every shelf the reader can see, grouped by owner with their own first. */
export function Shelves() {
  const viewer = useCurrentUser();
  const shelves = useQuery(shelvesQuery);
  const client = useQueryClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState<ShelfQuery>(() => ({
    text: "",
    owner: null,
    kind: "any",
    sort: loadDiscoveryPrefs().shelves_sort,
  }));
  const edit = (change: Partial<ShelfQuery>) =>
    setQuery((q) => ({ ...q, ...change }));

  if (!shelves.data) {
    return shelves.isError ? (
      <PageError message={shelves.error.message} />
    ) : (
      <Loading kind="page" label="Gathering your shelves" />
    );
  }
  const all = shelves.data;
  const groups = groupShelves(all, viewer.id, query);
  const everyone = owners(all, viewer.id);

  return (
    <>
      <div className="idx-page shv-page" data-testid="shelves-index">
        <PageTitle page="Shelves" />
        <div className="idx-header shv-header">
          <div className="shv-head-row">
            <div>
              <h1 className="disc-hero-title">Shelves</h1>
              <p className="idx-subtitle" data-testid="shelves-census">
                {census(all, viewer.id)}
              </p>
              {viewer.isAdmin && showsOthersPrivate(all, viewer.id) && (
                <p className="shv-admin-note" data-testid="shelves-admin-note">
                  <LockGlyph />
                  Includes other readers’ private shelves — you can see them as
                  an admin.
                </p>
              )}
            </div>
            <button
              type="button"
              className="btn primary shv-new"
              data-testid="new-shelf"
              onClick={() => setCreating(true)}
            >
              <span className="shv-new-plus" aria-hidden="true">
                ＋
              </span>
              New shelf
            </button>
          </div>
        </div>
        <div className="idx-toolbar shv-toolbar">
          <div className="idx-search">
            <input
              type="search"
              placeholder="Filter by shelf or owner…"
              aria-label="Filter shelves by name or owner"
              value={query.text}
              data-testid="shelves-filter"
              onChange={(e) => edit({ text: e.target.value })}
            />
          </div>
          {/* biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and min-width the idx-sort rules never reset */}
          <div className="idx-sort" role="group" aria-label="Shelf kind">
            <span className="label">Kind</span>
            {KINDS.map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                className="idx-btn"
                aria-pressed={query.kind === kind}
                data-testid={`shelves-kind-${kind}`}
                onClick={() => edit({ kind })}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="idx-sort">
            <span className="label">Sort</span>
            {SORTS.map(([sort, label, testid]) => (
              <button
                key={sort}
                type="button"
                className="idx-btn"
                aria-pressed={query.sort === sort}
                data-testid={testid}
                onClick={() => {
                  edit({ sort });
                  saveDiscoverySort("shelves_sort", sort);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {everyone.length > 1 && (
          // biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and min-width the shv-owners rules never reset
          <div className="shv-owners" role="group" aria-label="Owner">
            <span className="label">Owner</span>
            <button
              type="button"
              className={
                query.owner === null
                  ? "chip on shv-owner-chip shv-owner-chip--all"
                  : "chip shv-owner-chip shv-owner-chip--all"
              }
              aria-pressed={query.owner === null}
              data-testid="shelves-owner-anyone"
              onClick={() => edit({ owner: null })}
            >
              Everyone
              <span className="count">{all.length}</span>
            </button>
            {everyone.map((owner) => {
              const on = query.owner === owner.id;
              return (
                <button
                  key={owner.id}
                  type="button"
                  className={
                    on ? "chip on shv-owner-chip" : "chip shv-owner-chip"
                  }
                  aria-pressed={on}
                  data-testid={`shelves-owner-${owner.id}`}
                  onClick={() => edit({ owner: on ? null : owner.id })}
                >
                  <span className="shv-chip-av" aria-hidden="true">
                    <UserAvatar
                      user={owner}
                      className="shv-av"
                      photoClassName="shv-av-photo"
                    />
                  </span>
                  {owner.isViewer ? "You" : owner.name}
                  <span className="count">{owner.shelfCount}</span>
                </button>
              );
            })}
          </div>
        )}
        {groups.length === 0 ? (
          <div className="shv-empty" data-testid="shelves-empty">
            <p className="shv-empty-msg">
              {emptyMessage(query, all.length > 0)}
            </p>
            {isFiltering(query) ? (
              <button
                type="button"
                className="btn"
                data-testid="shelves-clear-filters"
                onClick={() => edit({ text: "", owner: null, kind: "any" })}
              >
                Clear filters
              </button>
            ) : (
              <button
                type="button"
                className="btn primary"
                data-testid="shelves-empty-new"
                onClick={() => setCreating(true)}
              >
                ＋ New shelf
              </button>
            )}
          </div>
        ) : (
          <div className="shv-body">
            {groups.map(({ owner, shelves: members }) => (
              <section
                key={owner.id}
                className="shv-group"
                data-testid={`shelves-group-${owner.id}`}
                aria-labelledby={`shv-group-${owner.id}`}
              >
                <header className="shv-group-head">
                  <span className="shv-group-av" aria-hidden="true">
                    <UserAvatar
                      user={owner}
                      className="shv-av"
                      photoClassName="shv-av-photo"
                    />
                  </span>
                  <h2 className="shv-group-title" id={`shv-group-${owner.id}`}>
                    {groupTitle(owner)}
                  </h2>
                  <span className="mono shv-group-count">{members.length}</span>
                </header>
                {/* biome-ignore lint/a11y/useSemanticElements: the cells are blocks the grid lays out, not list items */}
                <div className="shv-grid" role="list">
                  {members.map((shelf) => (
                    // biome-ignore lint/a11y/useSemanticElements: see the grid above
                    <div key={shelf.id} className="shv-cell" role="listitem">
                      <Link
                        to={`/shelves/${shelf.id}`}
                        className="shv-card"
                        style={accentStyle(shelf)}
                        data-testid={`shelf-card-${shelf.id}`}
                      >
                        <ShelfTileFace
                          shelf={shelf}
                          viewerId={viewer.id}
                          prefix="shelf-card"
                          ownerLabel={owner.isViewer ? "You" : shelf.owner.name}
                        />
                      </Link>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
      {creating && (
        <CreateShelfModal
          onClose={() => setCreating(false)}
          onCreated={(shelf) => {
            client.invalidateQueries({ queryKey: shelvesQuery.queryKey });
            setCreating(false);
            navigate(`/shelves/${shelf.id}`);
          }}
        />
      )}
    </>
  );
}
