import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import { type MetaForm, nameCountsQuery } from "../../api";
import { ChipInput } from "../../components/ChipInput/ChipInput";
import { bookCount } from "../../format";
import type { CoverProps } from "./CoverEditor";
import type { DirtyLabel } from "./dirty";
import { EditionPicker } from "./EditionPicker";
import { MeArea, MeField, MeLabel } from "./MetaFields";

type Props = {
  form: UseFormReturn<MetaForm>;
  /** The form as the book loaded, which the edition picker counts changes against. */
  baseline: MetaForm;
  cover: CoverProps;
  /** Labels of the edited fields, from `dirtyLabels`. */
  dirty: DirtyLabel[];
  sortBy: string;
  filename: string;
  /** A write is in flight: the fields hold still, so nothing typed now is lost when it lands. */
  disabled: boolean;
};

/** The edit form's fields, bound to `form`: the grid, then tags, genres and series. */
export function MetaFormGrid({
  form,
  baseline,
  cover,
  dirty,
  sortBy,
  filename,
  disabled,
}: Props) {
  const { register, control } = form;
  const edited = (label: DirtyLabel) => dirty.includes(label);
  // A suggestion pool is a convenience: while it loads, or if it fails, the field takes free text.
  const pools = {
    author: useQuery(nameCountsQuery("author")).data ?? [],
    tag: useQuery(nameCountsQuery("tag")).data ?? [],
    genre: useQuery(nameCountsQuery("genre")).data ?? [],
    series: useQuery(nameCountsQuery("series")).data ?? [],
  };
  const seriesList = useId();
  return (
    <fieldset className="me-form" disabled={disabled}>
      <div className="me-field-grid">
        <MeField
          label="Title"
          w={2}
          big
          edited={edited("Title")}
          input={register("title")}
        />
        <MeField
          label="Sort by"
          mono
          locked
          hint="from file-as"
          input={{ value: sortBy }}
        />
        <MeField label="Filename" mono locked input={{ value: filename }} />
        <MeField
          label="Publisher"
          w={2}
          edited={edited("Publisher")}
          input={register("publisher")}
        />
        <MeField
          label="Published"
          mono
          edited={edited("Published")}
          input={register("published")}
        />
        <MeField
          label="Language"
          edited={edited("Language")}
          input={register("language")}
        />
        <MeField
          label="ISBN-13"
          mono
          hint="13 digits"
          placeholder="e.g. 9780134685991"
          edited={edited("ISBN-13")}
          input={register("isbn13")}
        />
        <MeField
          label="ISBN-10"
          mono
          hint="10 characters"
          placeholder="e.g. 0134685997"
          edited={edited("ISBN-10")}
          input={register("isbn10")}
        />
        <MeField
          label="Print Pages"
          mono
          hint="whole number"
          placeholder="e.g. 320"
          edited={edited("Print Pages")}
          input={register("printPages")}
        />
        <div className="me-field-full">
          <MeLabel
            text="Author(s)"
            edited={edited("Authors")}
            hint="primary author first"
          />
          <div className="me-chip-row">
            <Controller
              name="authors"
              control={control}
              render={({ field }) => (
                <ChipInput
                  label="Author(s)"
                  values={field.value}
                  onChange={field.onChange}
                  suggestions={pools.author}
                  placeholder="+ add author…"
                  removeLabel="Remove"
                  inputClass="me-chip-input"
                  avatar
                  testId="me-authors-input"
                />
              )}
            />
          </div>
        </div>
        <MeArea
          label="Description"
          rows={5}
          hint="plain text or HTML"
          edited={edited("Description")}
          input={register("description")}
        />
        <div className="me-field-full">
          <EditionPicker form={form} baseline={baseline} cover={cover} />
        </div>
      </div>
      <div className="divider" />
      <div className="me-tags-header">
        <div className="label">Tags</div>
      </div>
      <div className="me-tag-chips">
        <Controller
          name="tags"
          control={control}
          render={({ field }) => (
            <ChipInput
              label="Tags"
              values={field.value}
              onChange={field.onChange}
              suggestions={pools.tag}
              placeholder="+ add tag…"
              removeLabel="Remove tag"
              testId="me-tags-input"
            />
          )}
        />
      </div>
      <div className="divider" />
      <div className="me-tags-header">
        <div className="label">Genres</div>
      </div>
      <div className="me-tag-chips" data-testid="me-genres-section">
        <Controller
          name="genres"
          control={control}
          render={({ field }) => (
            <ChipInput
              label="Genres"
              values={field.value}
              onChange={field.onChange}
              suggestions={pools.genre}
              placeholder="+ add genre…"
              removeLabel="Remove genre"
              testId="me-genres-input"
            />
          )}
        />
      </div>
      <div className="divider" />
      <div className="label">Series &amp; position</div>
      <div className="me-series-grid">
        <MeField
          label="Series"
          placeholder="not part of a series"
          edited={edited("Series")}
          input={{ ...register("series"), list: seriesList }}
        />
        <datalist id={seriesList}>
          {pools.series.map((s) => (
            <option key={s.name} value={s.name} label={bookCount(s.count)} />
          ))}
        </datalist>
        <MeField
          label="Book #"
          mono
          placeholder="—"
          edited={edited("Book #")}
          input={register("seriesIndex")}
        />
      </div>
    </fieldset>
  );
}
