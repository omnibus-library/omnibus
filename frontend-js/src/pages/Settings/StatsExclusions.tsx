import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import {
  type BookPage,
  type FilterClause,
  fetchBookPage,
  shelvesQuery,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { FilterBar } from "../../components/FilterBar/FilterBar";
import { facetValue, fieldLabel } from "../../components/FilterBar/filters";
import { Loading } from "../../components/Loading/Loading";
import { Modal } from "../../components/Modal/Modal";
import { bookCount } from "../../format";
import { useCurrentUser, useStatsExclusions } from "../../session";
import { SaveStatus, SettingRow } from "./SettingRow";

/** The library's first page under `clauses`, folded by series: the one request that says what a filter would leave out. */
function usePreview(clauses: FilterClause[]) {
  return useQuery({
    queryKey: ["stats-exclusions-preview", clauses],
    queryFn: () =>
      fetchBookPage(
        {
          sort: "title",
          dir: "asc",
          clauses,
          excludeFormats: [],
          stackSeries: true,
        },
        "",
      ),
    enabled: clauses.length > 0,
  });
}

function PreviewLines({ page }: { page: BookPage }) {
  const leads = new Set(page.stacks.map((stack) => stack.leadUuid));
  const loose = page.books.filter((book) => !leads.has(book.uuid)).length;
  return (
    <>
      <p className="stats-excl-total">{bookCount(page.total)} left out</p>
      <ul className="stats-excl-lines">
        {page.stacks.map((stack) => (
          <li
            key={stack.leadUuid}
          >{`${stack.name} · ${stack.members.length}`}</li>
        ))}
        {loose > 0 && <li>{loose} outside a series</li>}
      </ul>
      {page.next !== null && (
        <p className="setting-row-desc">
          The series list covers the first page of these books.
        </p>
      )}
    </>
  );
}

/** What a filter would leave out of the stats, counted from the library. */
function Preview({ clauses }: { clauses: FilterClause[] }) {
  const preview = usePreview(clauses);
  let body: ReactNode;
  if (clauses.length === 0) {
    body = (
      <p className="setting-row-desc">
        Pick a filter to see which books it leaves out.
      </p>
    );
  } else if (preview.isPending) {
    body = <Loading kind="section" label="Counting books…" />;
  } else if (preview.isError) {
    body = (
      <p role="alert" className="pref-status error">
        Couldn’t count the books: {preview.error.message}
      </p>
    );
  } else {
    body = <PreviewLines page={preview.data} />;
  }
  return (
    <div className="stats-excl-preview" data-testid="stats-exclusions-preview">
      {body}
    </div>
  );
}

function EditDialog({
  initial,
  onSave,
  onClose,
}: {
  initial: FilterClause[];
  onSave: (clauses: FilterClause[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <Modal
      label="Leave out of my stats"
      backdropClass="stats-excl-backdrop"
      dialogClass="stats-excl-dialog"
      dialogTestId="stats-exclusions-dialog"
      onClose={onClose}
    >
      <h4 className="stats-excl-title">Leave out of my stats</h4>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: it only keeps a filter menu's Escape from closing the dialog around it */}
      <div
        onKeyDown={(e) => {
          // The menu has already taken this Escape; the dialog stays.
          if (e.key === "Escape" && e.defaultPrevented) e.stopPropagation();
        }}
      >
        <FilterBar clauses={draft} onChange={setDraft} />
      </div>
      <Preview clauses={draft} />
      <div className="stats-excl-foot">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => onSave(draft)}>
          Save
        </Button>
      </div>
    </Modal>
  );
}

/** The chips of a saved rule and how many books it leaves out; a count that hasn't arrived shows a sheen. */
function Summary({ clauses }: { clauses: FilterClause[] }) {
  const shelves = useQuery(shelvesQuery);
  const viewerId = useCurrentUser().id;
  const preview = usePreview(clauses);
  return (
    <>
      {clauses.map((clause) => (
        <span key={clause.field} className="stats-excl-chip">
          {fieldLabel(clause.field)}:{" "}
          {facetValue(clause, shelves, viewerId).map((part) =>
            part === null ? (
              <span key="pending" className="ld-sheen">
                …
              </span>
            ) : (
              part
            ),
          )}
        </span>
      ))}
      {preview.data ? (
        <span>{bookCount(preview.data.total)}</span>
      ) : (
        preview.isPending && <span className="ld-sheen">…</span>
      )}
    </>
  );
}

/** "Leave out of my stats": the saved filter at a glance, and a dialog to change it. */
export function StatsExclusions() {
  const { statsExclusions } = useCurrentUser();
  const save = useStatsExclusions();
  const [editing, setEditing] = useState(false);
  return (
    <SettingRow
      label="Leave out of my stats"
      description="Books matching this filter don’t count toward your stats, including what other readers see of them."
      controlId="stats-exclusions-summary"
      testId="user-setting-stats-exclusions"
    >
      <div className="pref-control stats-excl-control">
        <SaveStatus testId="stats-exclusions-status" save={save} />
        <output id="stats-exclusions-summary" className="stats-excl-summary">
          {statsExclusions.length === 0 ? (
            "Nothing left out."
          ) : (
            <Summary clauses={statsExclusions} />
          )}
        </output>
        <Button
          size="sm"
          disabled={save.isPending}
          onClick={() => setEditing(true)}
        >
          Edit filters
        </Button>
      </div>
      {editing && (
        <EditDialog
          initial={statsExclusions}
          onClose={() => setEditing(false)}
          onSave={(clauses) => {
            save.mutate(clauses);
            setEditing(false);
          }}
        />
      )}
    </SettingRow>
  );
}
