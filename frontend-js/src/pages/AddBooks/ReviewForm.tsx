import { zodResolver } from "@hookform/resolvers/zod";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import {
  editFormSchema,
  hasIdentity,
  type Inspected,
  type MetaForm,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { useUnloadGuard } from "../../components/Unsaved/Unsaved";
import {
  CoverEditor,
  type CoverProps,
  coverPreview,
  restage,
  type StagedCover,
} from "../BookEdit/CoverEditor";
import { DetailsPanel } from "../BookEdit/DetailsPanel";
import { dirtyLabels } from "../BookEdit/dirty";
import { SheetHead } from "../BookEdit/EditHeader";
import { FetchView } from "../BookEdit/FetchView";
import {
  FetchToggle,
  IdentifiersPanel,
  Panel,
  SheetTabs,
  useSheetView,
} from "../BookEdit/SheetTabs";

/** The Add to library button's id: where focus lands when the leave bar is dismissed and nothing better holds it. */
const ADD_ID = "ab-add";

type Props = {
  pick: Inspected;
  /** The add is in flight, and how much of its body has gone up. */
  adding: { progress: number } | null;
  /** Why the last add failed. */
  error: string | undefined;
  /** The staged cover URL the Added step took over: not ours to release. */
  handedOff: RefObject<string | null>;
  /** Where the sheet's Escape and backdrop clicks are routed while the review shows. */
  dismiss: RefObject<() => void>;
  onAdd: (values: MetaForm, cover: StagedCover) => void;
  onChooseAnother: () => void;
  onClose: () => void;
};

/** The edit sheet's tabs, fields and Fetch metadata over an upload that isn't in the library yet. */
export function ReviewForm({
  pick,
  adding,
  error,
  handedOff,
  dismiss,
  onAdd,
  onChooseAnother,
  onClose,
}: Props) {
  const form = useForm<MetaForm>({
    resolver: zodResolver(editFormSchema(pick.form)),
    defaultValues: pick.form,
    mode: "onChange",
  });
  const [staged, setStaged] = useState<StagedCover>({
    source: { kind: "keep" },
    preview: pick.coverPreview,
    originalPreview: pick.coverPreview,
  });
  // A picked image's object URL is ours to release when the review goes away, unless the add kept it.
  const latest = useRef(staged);
  latest.current = staged;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `handedOff` is a ref, read as the review goes away
  useEffect(
    () => () => {
      const { preview, originalPreview } = latest.current;
      if (
        preview &&
        preview !== originalPreview &&
        preview !== handedOff.current
      )
        URL.revokeObjectURL(preview);
    },
    [],
  );
  const view = useSheetView();
  const [missing, setMissing] = useState<string>();
  // Which way out the leave bar is asking about, once there are edits to lose.
  const [asking, setAsking] = useState<"close" | "choose" | null>(null);
  const saving = adding !== null;
  const values = form.watch();
  const dirty = dirtyLabels(pick.form, values);
  const coverChanged = staged.source.kind !== "keep";
  const edits = dirty.length + (coverChanged ? 1 : 0);
  const invalid = Object.keys(form.formState.errors).length > 0;

  useUnloadGuard(edits > 0 || saving);

  // Where focus was when the leave bar took over, so Keep editing can hand it back.
  const beforeAsk = useRef<Element | null>(null);
  const keeping = useRef(false);
  const ask = (way: "close" | "choose", leave: () => void) => {
    // The add is under way and nothing cancels it: leaving would only hide it.
    if (saving) return;
    if (edits === 0) return leave();
    beforeAsk.current = document.activeElement;
    setAsking(way);
  };
  const requestClose = () => ask("close", onClose);
  useEffect(() => {
    dismiss.current = requestClose;
  });
  const keepEditing = () => {
    keeping.current = true;
    setAsking(null);
  };
  useEffect(() => {
    if (asking || !keeping.current) return;
    keeping.current = false;
    // Back to what held it, or Add to library once that went with the bar it was in.
    const back = beforeAsk.current;
    const target =
      back instanceof HTMLElement && back.isConnected && back !== document.body
        ? back
        : document.getElementById(ADD_ID);
    target?.focus();
  }, [asking]);

  const cover = {
    book: {
      displayTitle: values.title || pick.label,
      primaryAuthor: values.authors[0]
        ? { name: values.authors[0], id: null }
        : null,
      accent: null,
      coverUrl: null,
      hasCoverOverride: false,
    },
    target: { kind: "staged", staged, onStage: setStaged },
    disabled: saving,
  } satisfies CoverProps;

  const submit = form.handleSubmit((reviewed) => {
    // Refused here rather than as a 400 after the upload.
    const refusal = hasIdentity(reviewed)
      ? undefined
      : "A title and at least one author are required.";
    setMissing(refusal);
    if (!refusal) onAdd(reviewed, staged);
  }, view.showDetails);
  const problem = missing ?? error;

  return (
    <div className="es-sheet">
      <SheetHead
        cover={coverPreview(cover)}
        title={values.title}
        author={values.authors[0] ?? ""}
        fetch={
          <FetchToggle
            fetching={view.fetching}
            disabled={saving}
            onToggle={() => view.setFetching(!view.fetching)}
          />
        }
        closeDisabled={saving}
        onClose={requestClose}
      />
      <SheetTabs
        tab={view.tab}
        edited={{
          details: dirty.length > 0,
          artwork: coverChanged,
          identifiers: false,
        }}
        hidden={view.fetching}
        onSelect={view.setTab}
      />
      {/* The add has already read the form, so nothing in the body may change it until it lands. */}
      <div className="es-body" inert={saving}>
        {view.fetching && (
          <FetchView
            form={form}
            hasCover={staged.preview !== null}
            onHoldCover={(url) =>
              setStaged(restage(staged, { kind: "url", url }, url))
            }
            coverNote="Added with the book"
            onBack={view.leaveFetch}
            onApplied={view.applied}
          />
        )}
        <Panel tab="details" current={view.tab} fetching={view.fetching}>
          <DetailsPanel
            form={form}
            dirty={dirty}
            disabled={saving}
            hasOverride={false}
            onRevert={() => {}}
          />
        </Panel>
        <Panel tab="artwork" current={view.tab} fetching={view.fetching}>
          <CoverEditor {...cover} />
        </Panel>
        <Panel tab="identifiers" current={view.tab} fetching={view.fetching}>
          <IdentifiersPanel identifiers={pick.identifiers} />
        </Panel>
      </div>
      <footer className="es-foot ab-review-foot">
        {adding && (
          <progress
            className="ab-add-progress"
            aria-label="Upload progress"
            value={adding.progress}
            max={1}
          />
        )}
        {asking ? (
          // biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and min-width the bar never wants
          <div
            className="es-bar es-leave"
            role="group"
            aria-labelledby="ab-leave-text"
            data-testid="add-book-leave"
          >
            <p
              className="es-bar-text es-leave-text"
              id="ab-leave-text"
              role="alert"
            >
              Discard this book? Nothing has been added yet.
            </p>
            <Button
              autoFocus
              variant="ghost"
              disabled={saving}
              onClick={keepEditing}
            >
              Keep editing
            </Button>
            <Button
              disabled={saving}
              onClick={asking === "choose" ? onChooseAnother : onClose}
            >
              Discard book
            </Button>
          </div>
        ) : (
          <div className="es-bar">
            <p className="es-bar-text ab-file" data-testid="add-book-file">
              {pick.label}
            </p>
            {problem ? (
              <p className="es-bar-problem" role="alert">
                {problem}
              </p>
            ) : (
              invalid && (
                <p className="es-bar-problem">
                  Fix the highlighted field to add the book
                </p>
              )
            )}
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => ask("choose", onChooseAnother)}
            >
              Choose another file
            </Button>
            <Button
              id={ADD_ID}
              variant="primary"
              disabled={invalid || saving}
              aria-busy={saving}
              onClick={submit}
            >
              {adding
                ? `Adding… ${Math.round(adding.progress * 100)}%`
                : "Add to library"}
            </Button>
          </div>
        )}
        <p className="es-note">
          Nothing is added until you choose Add to library. Omnibus never writes
          to your book files.
        </p>
      </footer>
    </div>
  );
}
