import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import {
  hasIdentity,
  type Inspected,
  type MetaForm,
  MetaFormSchema,
} from "../../api";
import type { CoverProps, StagedCover } from "../BookEdit/CoverEditor";
import { dirtyLabels } from "../BookEdit/dirty";
import { PageHeader } from "../BookEdit/EditHeader";
import { MetaFormGrid } from "../BookEdit/MetaFormGrid";
import { SaveBar } from "../BookEdit/SaveBar";
import { Sidebar } from "../BookEdit/Sidebar";

type Props = {
  pick: Inspected;
  /** The add is in flight. */
  saving: boolean;
  /** Why the last add failed. */
  error: string | undefined;
  onAdd: (values: MetaForm, cover: StagedCover) => void;
  onStartOver: () => void;
};

/** The metadata edit page's grid, sidebar and save bar over an upload that does not exist yet. */
export function ReviewForm({ pick, saving, error, onAdd, onStartOver }: Props) {
  const form = useForm<MetaForm>({
    resolver: zodResolver(MetaFormSchema),
    defaultValues: pick.form,
  });
  const [staged, setStaged] = useState<StagedCover>({
    source: { kind: "keep" },
    preview: pick.coverPreview,
    originalPreview: pick.coverPreview,
  });
  // A picked image's object URL is ours to release when the review goes away.
  const latest = useRef(staged);
  latest.current = staged;
  useEffect(
    () => () => {
      const { preview, originalPreview } = latest.current;
      if (preview && preview !== originalPreview) URL.revokeObjectURL(preview);
    },
    [],
  );
  const [missing, setMissing] = useState<string>();
  const dirty = dirtyLabels(pick.form, form.watch());
  const cover = {
    book: {
      displayTitle: pick.form.title || pick.label,
      primaryAuthor: pick.form.authors[0]
        ? { name: pick.form.authors[0], id: null }
        : null,
      accent: null,
      coverUrl: null,
      hasCoverOverride: false,
    },
    target: { kind: "staged", staged, onStage: setStaged },
    // A staged cover is not written until the add.
    onApplied: () => {},
  } satisfies CoverProps;

  return (
    <div className="me-root" data-testid="add-books-review">
      <PageHeader
        displayTitle={cover.book.displayTitle}
        author={cover.book.primaryAuthor?.name}
        kicker="Review before adding"
        hint="nothing is saved until you add the book"
      />
      <div className="me-layout">
        <MetaFormGrid
          form={form}
          baseline={pick.form}
          cover={cover}
          dirty={dirty}
          sortBy=""
          filename={pick.label}
        />
        <Sidebar
          book={{ identifiers: pick.identifiers, hasOverride: false }}
          cover={cover}
          saving={saving}
          onRevert={() => {}}
        />
      </div>
      <SaveBar
        mode={{ kind: "create" }}
        dirty={dirty}
        coverReplaced={staged.source.kind !== "keep"}
        saving={saving}
        error={form.formState.errors.printPages?.message ?? missing ?? error}
        onSave={form.handleSubmit((values) => {
          // Refused here rather than as a 400 after the upload.
          const refusal = hasIdentity(values)
            ? undefined
            : "A title and at least one author are required.";
          setMissing(refusal);
          if (!refusal) onAdd(values, staged);
        })}
        onDiscard={onStartOver}
      />
    </div>
  );
}
