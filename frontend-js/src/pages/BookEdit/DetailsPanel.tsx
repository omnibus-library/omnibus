import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import { type MetaForm, nameCountsQuery } from "../../api";
import { Button } from "../../components/Button/Button";
import { ChipInput } from "../../components/ChipInput/ChipInput";
import { bookCount } from "../../format";
import type { DirtyLabel } from "./dirty";
import { MeArea, MeField, MeLabel } from "./MetaFields";

type Props = {
  form: UseFormReturn<MetaForm>;
  /** Labels of the edited fields, from `dirtyLabels`. */
  dirty: DirtyLabel[];
  /** A write is in flight: the fields hold still, so nothing typed now is lost when it lands. */
  disabled: boolean;
  /** The book has overrides to drop; the button that asks is the panel's last. */
  hasOverride: boolean;
  onRevert: () => void;
};

/** The sheet's Details: every field of the record in design order, each marked once edited and refused as it is typed. */
export function DetailsPanel({
  form,
  dirty,
  disabled,
  hasOverride,
  onRevert,
}: Props) {
  const { register, control } = form;
  const { errors } = form.formState;
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
    <fieldset className="es-fields" disabled={disabled}>
      <MeField
        label="Title"
        w={2}
        edited={edited("Title")}
        error={errors.title?.message}
        input={register("title")}
      />
      <div className="me-field me-field-w2">
        <MeLabel
          text="Authors"
          edited={edited("Authors")}
          hint="Primary author first"
        />
        <div className="me-chip-row">
          <Controller
            name="authors"
            control={control}
            render={({ field }) => (
              <ChipInput
                label="Authors"
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
      <MeField
        label="Series"
        placeholder="not part of a series"
        edited={edited("Series")}
        error={errors.series?.message}
        input={{ ...register("series"), list: seriesList }}
      />
      <datalist id={seriesList}>
        {pools.series.map((s) => (
          <option key={s.name} value={s.name} label={bookCount(s.count)} />
        ))}
      </datalist>
      <MeField
        label="Number in series"
        placeholder="—"
        edited={edited("Number in series")}
        error={errors.seriesIndex?.message}
        input={{ ...register("seriesIndex"), inputMode: "decimal" }}
      />
      <MeField
        label="Publisher"
        edited={edited("Publisher")}
        error={errors.publisher?.message}
        input={register("publisher")}
      />
      <MeField
        label="Published"
        placeholder="2014-02-18"
        edited={edited("Published")}
        error={errors.published?.message}
        input={{ ...register("published"), inputMode: "numeric" }}
      />
      <MeField
        label="Language"
        edited={edited("Language")}
        error={errors.language?.message}
        input={register("language")}
      />
      <MeField
        label="Print pages"
        placeholder="320"
        edited={edited("Print pages")}
        error={errors.printPages?.message}
        input={{ ...register("printPages"), inputMode: "numeric" }}
      />
      <MeField
        label="ISBN-13"
        hint="13 digits"
        placeholder="9780134685991"
        edited={edited("ISBN-13")}
        error={errors.isbn13?.message}
        input={{ ...register("isbn13"), inputMode: "numeric" }}
      />
      <MeField
        label="ISBN-10"
        hint="10 characters"
        placeholder="0134685997"
        edited={edited("ISBN-10")}
        error={errors.isbn10?.message}
        input={register("isbn10")}
      />
      <MeArea
        label="Description"
        rows={4}
        hint="Plain text or HTML"
        edited={edited("Description")}
        error={errors.description?.message}
        input={register("description")}
      />
      <div className="me-field me-field-w2">
        <MeLabel text="Tags" edited={edited("Tags")} />
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
      </div>
      <div className="me-field me-field-w2" data-testid="me-genres-section">
        <MeLabel text="Genres" edited={edited("Genres")} />
        <div className="me-tag-chips">
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
      </div>
      {hasOverride && (
        <div className="me-field me-field-w2 es-revert">
          <Button
            variant="ghost"
            data-testid="revert-overrides"
            onClick={onRevert}
          >
            Revert to scanned values
          </Button>
        </div>
      )}
    </fieldset>
  );
}
