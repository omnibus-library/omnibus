import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { coverFromUrl, type MetaForm, PROVIDERS } from "../../api";
import type { ProviderEdition } from "../../api/generated/schemas";
import { classes } from "../../classes";
import { Button } from "../../components/Button/Button";
import { Cover } from "../../components/Cover/Cover";
import { Loading, Ring } from "../../components/Loading/Loading";
import { type CoverProps, restage } from "./CoverEditor";
import {
  applyField,
  currentValue,
  differs,
  FIELDS,
  isStaged,
  type MetadataField,
  sourceValue,
} from "./editionFields";

/** Shown where a side of a row has no value. */
const EMPTY = "—";

/** Past this many characters on either side, a row is laid out down the panel's full width instead. */
const LONG_VALUE_CHARS = 90;

type Form = UseFormReturn<MetaForm>;

/** Copies the field's value from the source into the form, where the page's save bar counts and writes it. */
function copyField(form: Form, f: MetadataField, edition: ProviderEdition) {
  const value = applyField(f, edition);
  if (value !== undefined) form.setValue(f.key, value, { shouldDirty: true });
}

type RowProps = {
  field: MetadataField;
  edition: ProviderEdition;
  form: Form;
  values: MetaForm;
  baseline: MetaForm;
  hydrating: boolean;
};

/** One field: your value, the arrow that copies the source's into it (or undoes that), and the source's value. */
function CompareRow({
  field: f,
  edition,
  form,
  values,
  baseline,
  hydrating,
}: RowProps) {
  const sourceName = PROVIDERS[edition.source].name;
  const theirs = sourceValue(f, edition);
  const mine = currentValue(f, values);
  const available = theirs.trim() !== "";
  const staged = isStaged(f, values, baseline);
  const long =
    [...mine].length > LONG_VALUE_CHARS ||
    [...theirs].length > LONG_VALUE_CHARS;
  return (
    <div
      className={classes("mes-field", long && "mes-field-long")}
      data-testid={`mes-row-${f.slug}`}
      data-staged={staged}
    >
      <span className="mes-field-label">{f.label}</span>
      <span
        className="mes-field-mine"
        data-testid={`mes-row-${f.slug}-current`}
      >
        {mine.trim() === "" ? <span className="mes-empty">{EMPTY}</span> : mine}
      </span>
      {/* One control, two meanings: take the source's value, or once the field carries a change, put the book's back. */}
      {staged ? (
        <button
          type="button"
          className="mes-apply mes-undo"
          data-testid={`mes-row-${f.slug}-undo`}
          aria-label={`Undo the change to ${f.label}`}
          disabled={hydrating}
          onClick={() =>
            form.setValue(f.key, baseline[f.key], { shouldDirty: true })
          }
        >
          ↩
        </button>
      ) : (
        <button
          type="button"
          className="mes-apply"
          data-testid={`mes-row-${f.slug}-apply`}
          aria-label={`Copy ${f.label} from ${sourceName}`}
          // While the full record is in flight this is the thin search hit, not the answer.
          disabled={!available || hydrating}
          onClick={() => copyField(form, f, edition)}
        >
          →
        </button>
      )}
      <span
        className={classes("mes-field-theirs", !available && "mes-empty")}
        data-testid={`mes-row-${f.slug}-source`}
      >
        {available ? theirs : EMPTY}
      </span>
    </div>
  );
}

/** Yours-vs-theirs for the cover: the one row that writes at once against a saved book, and says so. */
function CoverRow({
  cover,
  edition,
}: {
  cover: CoverProps;
  edition: ProviderEdition;
}) {
  const { book, target, bust, onApplied } = cover;
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const sourceName = PROVIDERS[edition.source].name;
  const sourceUrl = edition.cover_url?.trim() || null;
  const live = target.kind === "live";
  const plate = {
    title: book.displayTitle,
    authors: book.primaryAuthor ? [book.primaryAuthor.name] : [],
    accent: book.accent,
  };

  async function apply(url: string) {
    if (target.kind === "staged") {
      target.onStage(restage(target.staged, { kind: "url", url }, url));
      setStatus("Cover staged.");
      return;
    }
    setBusy(true);
    setStatus("Applying cover…");
    try {
      onApplied(await coverFromUrl(target.uuid, url));
      setStatus("Cover updated.");
    } catch (e) {
      setStatus(
        `Couldn't apply that cover: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  const current =
    target.kind === "staged"
      ? target.staged.preview
      : book.coverUrl &&
        (bust > 0 ? `${book.coverUrl}?v=${bust}` : book.coverUrl);
  return (
    <div className="mes-cover" data-testid="mes-row-cover">
      <span className="mes-field-label">Cover</span>
      <span className="mes-cover-pair">
        <span className="mes-cover-cell" data-testid="mes-row-cover-current">
          <div className="mes-cover-thumb">
            <Cover book={plate} src={current || null} />
          </div>
        </span>
        <button
          type="button"
          className="mes-apply"
          data-testid="mes-row-cover-apply"
          aria-label={
            live
              ? `Use the cover from ${sourceName} — saves immediately`
              : `Use the cover from ${sourceName}`
          }
          disabled={!sourceUrl || busy}
          aria-busy={busy}
          onClick={() => sourceUrl && apply(sourceUrl)}
        >
          →
        </button>
        <span className="mes-cover-cell" data-testid="mes-row-cover-source">
          {sourceUrl ? (
            <img
              className="mes-cover-img"
              src={sourceUrl}
              alt=""
              loading="lazy"
            />
          ) : (
            <span className="mes-empty">{EMPTY}</span>
          )}
        </span>
      </span>
      <span
        className="mono mes-cover-note"
        role="status"
        data-testid="mes-row-cover-note"
      >
        {busy && <Ring size="xs" className="mes-cover-ring" />}
        {status ??
          (live
            ? "The cover applies immediately · it isn’t staged with the fields"
            : "The cover is saved with the book when you add it")}
      </span>
    </div>
  );
}

/** What the screen shows while the full record is arriving: the shape of the answer, without its content. */
function CompareSkeleton() {
  return (
    <div
      className="mes-skeleton"
      data-testid="mes-compare-skeleton"
      aria-hidden="true"
    >
      <div className="ld-skel mes-skel-cover" />
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="mes-skel-row">
          <span
            className="ld-skel mes-skel-bar mes-skel-label"
            style={{ "--i": i }}
          />
          <span className="ld-skel mes-skel-bar" style={{ "--i": i }} />
          <span className="ld-skel mes-skel-bar" style={{ "--i": i }} />
        </div>
      ))}
    </div>
  );
}

type Props = {
  edition: ProviderEdition;
  form: Form;
  /** The book as loaded: what "staged" is measured against, so the count agrees with the save bar's. */
  baseline: MetaForm;
  cover: CoverProps;
  hydrating: boolean;
  onBack: () => void;
  onDone: () => void;
};

/** Screen two: what this source would change, field by field. */
export function EditionCompare({
  edition,
  form,
  baseline,
  cover,
  hydrating,
  onBack,
  onDone,
}: Props) {
  const [showAll, setShowAll] = useState(false);
  const values = form.watch();
  const sourceName = PROVIDERS[edition.source];
  // A staged row stays on screen even once it stops differing, so pressing it doesn't erase the evidence.
  const shown = FIELDS.filter(
    (f) =>
      showAll || differs(f, values, edition) || isStaged(f, values, baseline),
  );
  const changes = FIELDS.filter((f) => differs(f, values, edition)).length;
  return (
    <div className="mes-screen" data-testid="mes-compare">
      <button
        type="button"
        className="mes-back"
        data-testid="mes-compare-back"
        onClick={onBack}
      >
        ← All results
      </button>
      <div className="mes-compare-head">
        <h2 className="mes-title">{edition.title}</h2>
        <span
          className="mes-badge"
          data-testid="mes-compare-source"
          data-source={sourceName.slug}
        >
          {sourceName.name}
        </span>
      </div>
      {hydrating ? (
        <>
          <Loading
            className="inline"
            testId="mes-hydrating"
            label="Loading the full record…"
          />
          <CompareSkeleton />
        </>
      ) : (
        <>
          {(edition.cover_url?.trim() || showAll) && (
            <CoverRow cover={cover} edition={edition} />
          )}
          <div className="mes-fields" data-testid="mes-compare-fields">
            {shown.map((f) => (
              <CompareRow
                key={f.slug}
                field={f}
                edition={edition}
                form={form}
                values={values}
                baseline={baseline}
                hydrating={hydrating}
              />
            ))}
          </div>
        </>
      )}
      <div className="mes-footbar">
        <Button
          variant="primary"
          data-testid="mes-take-all"
          disabled={hydrating || changes === 0}
          onClick={() => {
            for (const f of FIELDS) copyField(form, f, edition);
          }}
        >
          Take all
        </Button>
        <Button
          variant="ghost"
          data-testid="mes-show-all"
          aria-pressed={showAll}
          onClick={() => setShowAll(!showAll)}
        >
          {showAll ? "Only differences" : "Show all fields"}
        </Button>
        <Button
          variant="ghost"
          className="mes-done"
          data-testid="mes-done"
          onClick={onDone}
        >
          Done
        </Button>
        <p className="mono mes-foot" data-testid="mes-staged-hint">
          Fields aren't saved until you press Save on the form.
        </p>
      </div>
    </div>
  );
}
