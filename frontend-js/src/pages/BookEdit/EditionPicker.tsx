import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import {
  type EditionSearchRequest,
  type EditionSearchResponse,
  editionRequest,
  fillMissing,
  hasProviderQuery,
  hydrateEdition,
  inStableOrder,
  type MetaForm,
  PROVIDERS,
  type ProviderEdition,
  searchEditions,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { SparkleGlyph } from "../../components/Glyphs/Glyphs";
import { BusyLabel, Loading } from "../../components/Loading/Loading";
import { Modal } from "../../components/Modal/Modal";
import type { CoverProps } from "./CoverEditor";
import { coverSrc, EditionCompare, EMPTY } from "./EditionCompare";
import { sourceStatusText } from "./editionFields";

type FieldProps = {
  slug: "title" | "author" | "isbn";
  label: string;
  value: string;
  onChange: (value: string) => void;
};

/** One labelled field of the query; each provider is asked in its own terms, so they stay apart. */
function QueryField({ slug, label, value, onChange }: FieldProps) {
  return (
    <label className="mes-query-field" htmlFor={`mes-query-${slug}`}>
      <span className="mes-query-label">{label}</span>
      <input
        id={`mes-query-${slug}`}
        className="mes-query-input"
        data-testid={`mes-query-${slug}`}
        type={slug === "isbn" ? "text" : "search"}
        value={value}
        // The ISBN narrows every provider to one edition, so its placeholder says what filling it does.
        placeholder={slug === "isbn" ? "one exact edition" : label}
        // biome-ignore lint/a11y/noAutofocus: the dialog opens on the field a reader most likely corrects
        autoFocus={slug === "title"}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function imprint(edition: ProviderEdition) {
  const parts = [edition.year, edition.publisher, edition.isbn13].filter(
    (part): part is string => !!part?.trim(),
  );
  return parts.length ? parts.join(" · ") : EMPTY;
}

function CandidateRow({
  index,
  edition,
  onSelect,
}: {
  index: number;
  edition: ProviderEdition;
  onSelect: (edition: ProviderEdition) => void;
}) {
  const source = PROVIDERS[edition.source];
  const cover = coverSrc(edition);
  return (
    <li className="mes-row-item">
      <button
        type="button"
        className="mes-row"
        data-testid={`mes-candidate-${index}`}
        aria-label={`Compare ${edition.title} from ${source.name}`}
        onClick={() => onSelect(edition)}
      >
        {cover ? (
          <img className="mes-row-cover" src={cover} alt="" loading="lazy" />
        ) : (
          <span className="mes-row-cover mes-row-plate" aria-hidden="true">
            {EMPTY}
          </span>
        )}
        <span className="mes-row-body">
          <span
            className="mes-row-title"
            data-testid={`mes-candidate-${index}-title`}
          >
            {edition.title}
          </span>
          <span
            className="mes-row-authors"
            data-testid={`mes-candidate-${index}-authors`}
          >
            {edition.authors.length ? edition.authors.join(", ") : EMPTY}
          </span>
          <span
            className="mono mes-row-imprint"
            data-testid={`mes-candidate-${index}-imprint`}
          >
            {imprint(edition)}
          </span>
        </span>
        <span
          className="mes-badge"
          data-testid={`mes-candidate-${index}-source`}
          data-source={source.slug}
        >
          {source.name}
        </span>
      </button>
    </li>
  );
}

/** One line saying what each source contributed, so an outage never reads as an empty result. */
function SourceSummary({
  sources,
}: {
  sources: EditionSearchResponse["sources"];
}) {
  if (sources.length === 0) return null;
  return (
    <p className="mes-sources" data-testid="mes-sources" role="status">
      {sources.map((source) => {
        const { text, problem, detail } = sourceStatusText(source);
        return (
          <span
            key={source.provider}
            className={problem ? "mes-source mes-source-problem" : "mes-source"}
            data-testid={`mes-source-${PROVIDERS[source.provider].slug}`}
            title={detail}
          >
            {source.display_name} {text}
          </span>
        );
      })}
    </p>
  );
}

type Found = Pick<EditionSearchResponse, "sources"> & {
  editions: ProviderEdition[];
};

/** The query fields and the search they run, held above the screens so a trip to a candidate and back keeps them. */
function useEditionSearch(form: UseFormReturn<MetaForm>) {
  // Seeded from the book, ISBN included, but never searched on open: the reader sees what is about to be asked first.
  const [seed] = useState(() => form.getValues());
  const [title, setTitle] = useState(seed.title.trim());
  const [author, setAuthor] = useState(seed.authors[0]?.trim() ?? "");
  const [isbn, setIsbn] = useState(seed.isbn13.trim());
  const search = useMutation({
    mutationFn: async (req: EditionSearchRequest) => {
      const found = await searchEditions(req);
      return {
        sources: found.sources,
        editions: inStableOrder(found.editions, req.query),
      } satisfies Found;
    },
  });
  return {
    title,
    setTitle,
    author,
    setAuthor,
    isbn,
    setIsbn,
    search,
    request: editionRequest(title, author, isbn),
  };
}

/** Screen one: the query, already filled in, and what the providers found. */
function ResultsScreen({
  state: { title, setTitle, author, setAuthor, isbn, setIsbn, search, request },
  onSelect,
}: {
  state: ReturnType<typeof useEditionSearch>;
  onSelect: (edition: ProviderEdition) => void;
}) {
  return (
    <div className="mes-screen mes-screen-results" data-testid="mes-results">
      <h2 className="mes-title">Find this edition</h2>
      <form
        className="mes-query"
        onSubmit={(e) => {
          e.preventDefault();
          if (request) search.mutate(request);
        }}
      >
        <QueryField
          slug="title"
          label="Title"
          value={title}
          onChange={setTitle}
        />
        <QueryField
          slug="author"
          label="Author"
          value={author}
          onChange={setAuthor}
        />
        <QueryField slug="isbn" label="ISBN" value={isbn} onChange={setIsbn} />
        <Button
          type="submit"
          className="mes-query-btn"
          data-testid="mes-search"
          disabled={search.isPending || !request}
          aria-busy={search.isPending}
        >
          <BusyLabel
            busy={search.isPending}
            label="Search"
            busyLabel="Searching…"
          />
        </Button>
      </form>
      {search.isPending && (
        <Loading
          kind="sheet"
          testId="mes-searching"
          label="Asking every configured source…"
        />
      )}
      {search.isError && (
        <p className="mes-error" role="alert" data-testid="mes-error">
          {search.error.message}
        </p>
      )}
      {search.isIdle && (
        <p className="mes-note" data-testid="mes-ready">
          Check the fields, then search. An ISBN narrows every source to that
          one edition.
        </p>
      )}
      {search.data &&
        (search.data.editions.length === 0 ? (
          <p className="mes-note" role="status" data-testid="mes-empty">
            No editions matched. Try a shorter title, or just the author.
          </p>
        ) : (
          <ul className="mes-list" data-testid="mes-candidates">
            {search.data.editions.map((edition, index) => (
              <CandidateRow
                key={`${edition.source}:${edition.provider_ref}`}
                index={index}
                edition={edition}
                onSelect={onSelect}
              />
            ))}
          </ul>
        ))}
      {search.data && <SourceSummary sources={search.data.sources} />}
    </div>
  );
}

type PickerProps = {
  form: UseFormReturn<MetaForm>;
  /** The form as the book loaded: what the compare screen counts changes against. */
  baseline: MetaForm;
  cover: CoverProps;
};

function SearchOverlay({
  form,
  baseline,
  cover,
  onClose,
}: PickerProps & { onClose: () => void }) {
  const state = useEditionSearch(form);
  // The candidate being compared; `hydrating` while its full record is still on the way.
  const [compare, setCompare] = useState<{
    edition: ProviderEdition;
    hydrating: boolean;
  } | null>(null);

  const latest = useRef(0);

  // The full record fills in what the list row lacked and never takes a field away from it.
  const select = (edition: ProviderEdition) => {
    setCompare({ edition, hydrating: true });
    const request = ++latest.current;
    const land = (settled: ProviderEdition) =>
      // A slow answer must not overwrite a selection the reader has since replaced, or reappear after they went back.
      setCompare((now) =>
        now && request === latest.current
          ? { edition: settled, hydrating: false }
          : now,
      );
    hydrateEdition(edition).then(
      (full) => land(full ? fillMissing(full, edition) : edition),
      () => land(edition),
    );
  };

  return (
    <Modal
      label="Find this edition"
      backdropClass="mes-scrim"
      dialogClass="mes-panel"
      backdropTestId="metadata-search-scrim"
      dialogTestId="metadata-search"
      onClose={onClose}
    >
      <button
        type="button"
        className="mes-close"
        data-testid="mes-close"
        aria-label="Close"
        onClick={onClose}
      >
        ×
      </button>
      {compare ? (
        <EditionCompare
          edition={compare.edition}
          hydrating={compare.hydrating}
          form={form}
          baseline={baseline}
          cover={cover}
          onBack={() => setCompare(null)}
          onDone={onClose}
        />
      ) : (
        <ResultsScreen state={state} onSelect={select} />
      )}
    </Modal>
  );
}

/** The "Fetch metadata" button and, while open, the overlay it opens. Absent until a provider is set up. */
export function EditionPicker(props: PickerProps) {
  const available = useQuery(hasProviderQuery);
  const [open, setOpen] = useState(false);
  if (!available.data) return null;
  return (
    <>
      <Button
        className="mes-open-btn"
        data-testid="metadata-search-btn"
        onClick={() => setOpen(true)}
      >
        <span className="mes-open-mark" aria-hidden="true">
          <SparkleGlyph />
        </span>
        Fetch metadata
      </Button>
      {/* Mounted only while open, so every open starts a fresh search. */}
      {open && <SearchOverlay {...props} onClose={() => setOpen(false)} />}
    </>
  );
}
