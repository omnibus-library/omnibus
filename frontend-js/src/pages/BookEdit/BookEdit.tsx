import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router";
import {
  type BookUuid,
  coverFromUrl,
  type EditableBook,
  editableBookQuery,
  editFormSchema,
  type MetaForm,
  overridesFrom,
  parseBookUuid,
  revertOverrides,
  saveOverrides,
  uploadCover,
} from "../../api";
import { ConfirmDialog } from "../../components/ConfirmModal/ConfirmModal";
import { Loading } from "../../components/Loading/Loading";
import { PageError, PageNotFound } from "../../components/PageState/PageState";
import { Sheet } from "../../components/Sheet/Sheet";
import { useToast } from "../../components/Toast/Toast";
import { useLeaveGuard } from "../../components/Unsaved/Unsaved";
import { MORE_BUTTON_ID } from "../BookDetail/HeroActions";
import {
  CoverEditor,
  type CoverProps,
  coverPreview,
  type HeldCover,
  releaseHeld,
} from "./CoverEditor";
import { DetailsPanel } from "./DetailsPanel";
import { dirtyLabels } from "./dirty";
import { SheetHead } from "./EditHeader";
import { FetchView } from "./FetchView";
import { DONE_ID, SheetFooter } from "./SheetFooter";
import {
  FetchToggle,
  IdentifiersPanel,
  Panel,
  SheetTabs,
  useSheetView,
} from "./SheetTabs";
import "./BookEdit.css";
import "./EditSheet.css";

/** Where focus lands when the sheet closes and the control that opened it is gone: the hero's More button. */
const moreButton = {
  get current() {
    return document.getElementById(MORE_BUTTON_ID);
  },
};

function EditSheet({ book }: { book: EditableBook }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [params] = useSearchParams();
  // What the fields are measured against: the book as loaded, then as last written, so a save that half lands moves it.
  const [baseline, setBaseline] = useState(book.form);
  const form = useForm<MetaForm>({
    resolver: zodResolver(editFormSchema(baseline)),
    defaultValues: book.form,
    // A refused value says so as it is typed, and Done waits on it.
    mode: "onChange",
  });
  // The book as the server last reported it, which putting the scanned cover back moves; `book.form` stays the baseline.
  const [live, setLive] = useState(book);
  // A cover picked or fetched waits here for Done, like the fields.
  const [held, setHeld] = useState<HeldCover | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [confirmingRevert, setConfirmingRevert] = useState(false);
  const {
    tab,
    setTab,
    fetching,
    setFetching,
    applied,
    leaveFetch,
    showDetails,
  } = useSheetView();

  const dirty = dirtyLabels(baseline, form.watch());
  const count = dirty.length + (held ? 1 : 0);
  const invalid = Object.keys(form.formState.errors).length > 0;
  const { blocker, allowLeave } = useLeaveGuard(count > 0);
  const leaving = asking || blocker.state === "blocked";

  // An object URL outlives the pick that made it until it is released.
  const heldRef = useRef(held);
  heldRef.current = held;
  useEffect(() => () => releaseHeld(heldRef.current), []);

  // `?field=` opens on that input, once, as the sheet opens: Details' Add links.
  // biome-ignore lint/correctness/useExhaustiveDependencies: later changes to the address are not asks to move focus
  useEffect(() => {
    const field = params.get("field");
    if (
      field === "publisher" ||
      field === "published" ||
      field === "language" ||
      field === "isbn13"
    ) {
      form.setFocus(field);
    }
  }, []);

  // The book's page, the lists and the resume row all read what an edit changes.
  const written = () => {
    for (const queryKey of [
      ["book", book.uuid],
      ["books"],
      ["shelf-page"],
      ["shelves"],
      ["progress", "recent"],
    ]) {
      queryClient.invalidateQueries({ queryKey });
    }
  };
  // Back to the book page: the way the reader came, else straight to it, so Back never reopens the sheet.
  const leave = () =>
    location.state?.fromBook
      ? navigate(-1)
      : navigate(`/books/${book.uuid}`, { replace: true });
  const close = () => {
    allowLeave();
    setAsking(false);
    setClosing(true);
  };
  // A save, or "Don't save", settles whichever way out was asked for.
  const finish = () => {
    if (blocker.state === "blocked") {
      allowLeave();
      blocker.proceed();
    } else close();
  };
  // Where focus was when the leave bar took over, so Keep editing can hand it back.
  const beforeLeave = useRef<Element | null>(null);
  const keeping = useRef(false);
  const requestClose = () => {
    if (count === 0) return close();
    beforeLeave.current = document.activeElement;
    setAsking(true);
  };
  const keepEditing = () => {
    keeping.current = true;
    setAsking(false);
    if (blocker.state === "blocked") blocker.reset();
  };
  useEffect(() => {
    if (leaving || !keeping.current) return;
    keeping.current = false;
    // Back to what held it, or Done once that went with the bar it was in.
    const back = beforeLeave.current;
    const target =
      back instanceof HTMLElement && back.isConnected && back !== document.body
        ? back
        : document.getElementById(DONE_ID);
    target?.focus();
  }, [leaving]);

  const save = useMutation({
    mutationFn: async ({ values }: { values: MetaForm; changes: number }) => {
      await saveOverrides(book.uuid, overridesFrom(baseline, values));
      // The fields are written: the page hears of them and they stop counting as unsaved now, so a cover refused next leaves only the cover to try again.
      setBaseline(values);
      written();
      if (!held) return;
      try {
        if (held.source.kind === "file") {
          await uploadCover(book.uuid, held.source.file);
        } else {
          await coverFromUrl(book.uuid, held.source.url);
        }
      } catch (e) {
        throw new Error(
          `Cover not saved: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
    onSuccess: (_done, { values, changes }) => {
      written();
      const title = values.title.trim() || book.displayTitle;
      toast(`Saved ${changes} change${changes === 1 ? "" : "s"} to ${title}`);
      finish();
    },
  });
  const revert = useMutation({
    mutationFn: () => revertOverrides(book.uuid),
    onSuccess: () => {
      written();
      toast("Reverted to scanned values");
      setConfirmingRevert(false);
      close();
    },
  });
  const saving = save.isPending || revert.isPending;
  const locked = saving || coverBusy;

  const submit = () => {
    revert.reset();
    void form.handleSubmit(
      (values) => save.mutate({ values, changes: count }),
      showDetails,
    )();
  };
  const done = () => (count === 0 ? close() : submit());
  const discard = () => {
    save.reset();
    form.reset(baseline);
    releaseHeld(held);
    setHeld(null);
  };

  const cover = {
    book: live,
    target: {
      kind: "held",
      uuid: book.uuid,
      held,
      onHold: setHeld,
      // Exact, so the edit query holding the unsaved form isn't refetched out from under it.
      onReverted: (updated) => {
        setLive(updated);
        queryClient.invalidateQueries({
          queryKey: ["book", book.uuid],
          exact: true,
        });
        queryClient.invalidateQueries({ queryKey: ["books"] });
      },
    },
    disabled: saving,
    onBusy: setCoverBusy,
  } satisfies CoverProps;
  const values = form.watch();
  const shown = coverPreview(cover);
  return (
    <Sheet
      label={`Edit ${book.displayTitle}`}
      testId="edit-sheet"
      onDismiss={requestClose}
      closing={closing}
      onClosed={leave}
      busy={locked}
      fallbackFocus={moreButton}
    >
      <div className="es-sheet">
        <SheetHead
          cover={shown}
          title={values.title}
          author={values.authors[0] ?? ""}
          fetch={
            <FetchToggle
              fetching={fetching}
              disabled={locked}
              onToggle={() => setFetching(!fetching)}
            />
          }
          onClose={requestClose}
        />
        <SheetTabs
          tab={tab}
          edited={{
            details: dirty.length > 0,
            artwork: held !== null,
            identifiers: false,
          }}
          hidden={fetching}
          onSelect={setTab}
        />
        {/* A save has already read the form, so nothing in the body may change it until it lands. */}
        <div className="es-body" inert={saving}>
          {fetching && (
            <FetchView
              form={form}
              hasCover={live.coverUrl !== null || held !== null}
              onHoldCover={(url) => {
                releaseHeld(held);
                setHeld({ source: { kind: "url", url }, preview: url });
              }}
              onBack={leaveFetch}
              onApplied={applied}
            />
          )}
          <Panel tab="details" current={tab} fetching={fetching}>
            <DetailsPanel
              form={form}
              dirty={dirty}
              disabled={locked}
              hasOverride={live.hasOverride}
              onRevert={() => {
                revert.reset();
                setConfirmingRevert(true);
              }}
            />
          </Panel>
          <Panel tab="artwork" current={tab} fetching={fetching}>
            <CoverEditor {...cover} />
          </Panel>
          <Panel tab="identifiers" current={tab} fetching={fetching}>
            <IdentifiersPanel identifiers={live.identifiers} />
          </Panel>
        </div>
        <SheetFooter
          count={count}
          saving={saving}
          locked={locked}
          invalid={invalid}
          error={save.error?.message}
          leaving={leaving}
          onDone={done}
          onDiscard={discard}
          onKeepEditing={keepEditing}
          onDontSave={finish}
          onSave={submit}
        />
      </div>
      {confirmingRevert && (
        <ConfirmDialog
          testId="revert-overrides-modal"
          title="Revert to scanned values?"
          body="Every edit to this book, its cover included, is dropped and the values read from its files come back. This can’t be undone."
          action="Revert"
          busyLabel="Reverting…"
          busy={revert.isPending}
          note={
            revert.isError && (
              <p className="bd-merge-error" role="alert">
                {revert.error.message}
              </p>
            )
          }
          onCancel={() => setConfirmingRevert(false)}
          onConfirm={() => revert.mutate()}
        />
      )}
    </Sheet>
  );
}

/** The sheet's frame around what cannot be edited: the record still loading, or not there to edit. */
function EditUnavailable({
  uuid,
  children,
}: {
  uuid: BookUuid;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const back = () => navigate(`/books/${uuid}`, { replace: true });
  return (
    <Sheet
      label="Edit metadata"
      testId="edit-sheet"
      onDismiss={back}
      closing={false}
      onClosed={() => {}}
      fallbackFocus={moreButton}
    >
      <div className="es-sheet es-unavailable">{children}</div>
    </Sheet>
  );
}

function BookEditFor({ uuid }: { uuid: BookUuid }) {
  const book = useQuery(editableBookQuery(uuid));
  // A failed refetch keeps the form: the data it holds is what the user is editing.
  if (book.data) return <EditSheet book={book.data} />;
  switch (book.status) {
    case "pending":
      return (
        <EditUnavailable uuid={uuid}>
          <Loading kind="sheet" label="Opening the record" />
        </EditUnavailable>
      );
    case "error":
      return (
        <EditUnavailable uuid={uuid}>
          <PageError
            message={book.error.message}
            backTo={`/books/${uuid}`}
            backLabel="Back to book"
          />
        </EditUnavailable>
      );
    case "success":
      return (
        <EditUnavailable uuid={uuid}>
          <PageNotFound subject="Book" />
        </EditUnavailable>
      );
    default: {
      const _exhaustive: never = book;
      return _exhaustive;
    }
  }
}

/** The metadata editor: a sheet over the book page, opened by the `edit` child of `/books/:uuid`. */
export function BookEdit() {
  const uuid = parseBookUuid(useParams().uuid);
  return uuid ? <BookEditFor uuid={uuid} /> : <PageNotFound subject="Book" />;
}
