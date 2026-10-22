import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import {
  type EditionSearchRequest,
  type EditionSearchResponse,
  inStableOrder,
  type MetaForm,
  PROVIDERS,
  type ProviderEdition,
  searchEditions,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { CaretLeftGlyph } from "../../components/Glyphs/Glyphs";
import { Loading } from "../../components/Loading/Loading";
import { SourceSummary } from "./EditionPicker";
import { applyField, coverSrc, EMPTY, labelToId } from "./editionFields";
import { type DiffRow, diffRows, fetchRequest, onePerProvider } from "./fetch";
import { useHydrated } from "./useHydrated";

type Found = Pick<EditionSearchResponse, "sources"> & {
  editions: ProviderEdition[];
};

/** "Pierce Brown · Del Rey 2014 · 382 pages": the parts an edition has, in that order. */
function summary(edition: ProviderEdition) {
  return [
    edition.authors.join(", "),
    [edition.publisher, edition.year].filter(Boolean).join(" "),
    edition.pages ? `${edition.pages} pages` : "",
  ]
    .filter((part) => part.trim())
    .join(" · ");
}

/** The picked edition's differences: a checkbox per field, and the cover when it offers one. */
function EditionDiff({
  form,
  edition,
  hasCover,
  onApply,
}: {
  form: UseFormReturn<MetaForm>;
  edition: ProviderEdition;
  /** The book already has a cover, or one is held for it, so a fetched one does not start checked. */
  hasCover: boolean;
  onApply: (rows: DiffRow[], cover: string | null) => void;
}) {
  const rows = diffRows(form.watch(), edition);
  const cover = coverSrc(edition);
  // What the reader has toggled; a row not in here keeps the state it starts in.
  const [marks, setMarks] = useState<Record<string, boolean>>({});
  const on = (key: string, starts: boolean) => marks[key] ?? starts;
  const chosen = rows.filter((row) => on(row.field.slug, row.checked));
  const coverOn = cover !== null && on("cover", !hasCover);
  const count = chosen.length + (coverOn ? 1 : 0);
  if (rows.length === 0 && !cover) {
    return <p className="es-fetch-same">This edition matches what you have.</p>;
  }
  return (
    <div className="es-diff" data-testid="es-diff">
      <ul className="es-diff-list" aria-label="Changes from this edition">
        {cover && (
          <li>
            <label className="es-diff-row">
              <input
                type="checkbox"
                checked={coverOn}
                onChange={(e) =>
                  setMarks({ ...marks, cover: e.target.checked })
                }
              />
              <span className="es-diff-name">Cover</span>
              <span className="es-diff-change">
                <span className="es-diff-before">
                  {hasCover ? "Current cover" : EMPTY}
                </span>
                <span aria-hidden="true">→</span>
                <img className="es-diff-thumb" src={cover} alt="New cover" />
                <span className="es-diff-note">Saved when you press Done</span>
              </span>
            </label>
          </li>
        )}
        {rows.map((row) => (
          <li key={row.field.slug}>
            <label className="es-diff-row">
              <input
                type="checkbox"
                checked={on(row.field.slug, row.checked)}
                onChange={(e) =>
                  setMarks({ ...marks, [row.field.slug]: e.target.checked })
                }
              />
              <span className="es-diff-name">{row.field.label}</span>
              <span className="es-diff-change">
                <span
                  className={
                    row.before.trim() ? "es-diff-before" : "es-diff-empty"
                  }
                >
                  {row.before.trim() ? row.before : "Empty"}
                </span>
                <span aria-hidden="true">→</span>
                <span className="es-diff-after">{row.after}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="es-diff-actions">
        <Button
          variant="primary"
          disabled={count === 0}
          data-testid="es-apply"
          onClick={() => onApply(chosen, coverOn ? cover : null)}
        >
          Apply {count} change{count === 1 ? "" : "s"}
        </Button>
      </div>
    </div>
  );
}

/** The skeleton of an answer on its way: lines where the differences will be. */
function DiffSkeleton() {
  return (
    <div
      className="es-skeleton"
      data-testid="es-diff-skeleton"
      aria-hidden="true"
    >
      {[0, 1, 2].map((i) => (
        <span key={i} className="ld-skel es-skel-bar" style={{ "--i": i }} />
      ))}
    </div>
  );
}

type FetchViewProps = {
  form: UseFormReturn<MetaForm>;
  /** The book already has a cover, or one is held for it. */
  hasCover: boolean;
  /** A cover the reader checked: held until Done writes it. */
  onHoldCover: (url: string) => void;
  /** Back to the tabs, nothing applied. */
  onBack: () => void;
  /** Back to the tabs with the checked rows copied in: where to land, and the first edited field's input. */
  onApplied: (tab: "details" | "artwork", firstField: string | null) => void;
};

/**
 * Fetch metadata: one edition per provider for the title or ISBN asked, the picked one set
 * beside what the form holds, and the checked rows copied into the form for Done to save.
 */
export function FetchView({
  form,
  hasCover,
  onHoldCover,
  onBack,
  onApplied,
}: FetchViewProps) {
  const [query, setQuery] = useState(() => form.getValues("title").trim());
  const { picked, pick } = useHydrated();
  const search = useMutation({
    mutationFn: async (req: EditionSearchRequest) => {
      const found = await searchEditions(req);
      return {
        sources: found.sources,
        editions: onePerProvider(inStableOrder(found.editions, req.query)),
      } satisfies Found;
    },
  });
  const ask = (text: string) => {
    const request = fetchRequest(text, form.getValues("authors")[0] ?? "");
    if (request) search.mutate(request);
  };
  // Searches as it opens, on the form's title.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, as the view opens
  useEffect(() => ask(query), []);

  const apply = (rows: DiffRow[], cover: string | null) => {
    if (picked === null) return;
    for (const { field } of rows) {
      const value = applyField(field, picked.edition);
      if (value !== undefined) {
        form.setValue(field.key, value, {
          shouldDirty: true,
          shouldValidate: true,
        });
      }
    }
    if (cover) onHoldCover(cover);
    const first = rows[0];
    onApplied(
      first ? "details" : "artwork",
      first ? labelToId(first.field.label) : null,
    );
  };

  return (
    <section className="es-fetch" aria-labelledby="es-fetch-title">
      <div className="es-fetch-head">
        <h3 id="es-fetch-title">Fetch metadata</h3>
        <button
          type="button"
          className="bp-link-row"
          data-testid="es-fetch-back"
          onClick={onBack}
        >
          <CaretLeftGlyph size={16} />
          Back to editing
        </button>
      </div>
      <form
        className="es-fetch-query"
        onSubmit={(e) => {
          e.preventDefault();
          ask(query);
        }}
      >
        <label className="me-label" htmlFor="es-fetch-query">
          Title or ISBN
        </label>
        <div className="es-inline">
          <input
            id="es-fetch-query"
            className="me-input"
            type="search"
            value={query}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button
            type="submit"
            disabled={search.isPending || !fetchRequest(query, "")}
            aria-busy={search.isPending}
          >
            Search
          </Button>
        </div>
      </form>
      {search.isPending && (
        <Loading kind="inline" label="Asking every configured source…" />
      )}
      {search.isError && (
        <p className="es-fetch-note" role="alert">
          {search.error.message}
        </p>
      )}
      {search.data && <SourceSummary sources={search.data.sources} />}
      {search.data?.editions.length === 0 && (
        <p className="es-fetch-note" role="status" data-testid="es-fetch-empty">
          No editions matched. Try a shorter title, or the ISBN.
        </p>
      )}
      {search.data && search.data.editions.length > 0 && (
        <ul className="es-editions" aria-label="Matching editions">
          {search.data.editions.map((edition) => {
            const isPicked =
              picked?.edition.source === edition.source &&
              picked.edition.provider_ref === edition.provider_ref;
            const cover = coverSrc(edition);
            return (
              <li
                key={`${edition.source}:${edition.provider_ref}`}
                className={isPicked ? "es-edition is-picked" : "es-edition"}
              >
                <button
                  type="button"
                  className="es-edition-pick"
                  aria-pressed={isPicked}
                  data-testid={`es-edition-${PROVIDERS[edition.source].slug}`}
                  onClick={() => pick(edition)}
                >
                  {cover ? (
                    <img
                      className="es-edition-cover"
                      src={cover}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <span
                      className="es-edition-cover es-edition-plate"
                      aria-hidden="true"
                    >
                      {EMPTY}
                    </span>
                  )}
                  <span className="es-edition-text">
                    <span className="es-edition-name">{edition.title}</span>
                    <span className="es-edition-meta">
                      {summary(edition) || EMPTY}
                    </span>
                    <span className="es-edition-source">
                      {[PROVIDERS[edition.source].name, edition.isbn13]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="es-edition-mark" aria-hidden="true">
                    ✓
                  </span>
                </button>
                {isPicked && picked.hydrating && (
                  <div className="es-edition-diff">
                    <Loading kind="inline" label="Loading the full record…" />
                    <DiffSkeleton />
                  </div>
                )}
                {isPicked && !picked.hydrating && (
                  <div className="es-edition-diff">
                    <EditionDiff
                      key={picked.edition.provider_ref}
                      form={form}
                      edition={picked.edition}
                      hasCover={hasCover}
                      onApply={apply}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
