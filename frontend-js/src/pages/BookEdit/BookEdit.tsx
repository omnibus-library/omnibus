import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { type FieldErrors, useForm } from "react-hook-form";
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
  hasProviderQuery,
  type MetaForm,
  overridesFrom,
  parseBookUuid,
  revertOverrides,
  saveOverrides,
  uploadCover,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { ConfirmDialog } from "../../components/ConfirmModal/ConfirmModal";
import { SparkleGlyph } from "../../components/Glyphs/Glyphs";
import { Loading } from "../../components/Loading/Loading";
import { PageError, PageNotFound } from "../../components/PageState/PageState";
import { Sheet } from "../../components/Sheet/Sheet";
import { useToast } from "../../components/Toast/Toast";
import { useLeaveGuard } from "../../components/Unsaved/Unsaved";
import { prefersReducedMotion } from "../../motion";
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
import { SheetFooter } from "./SheetFooter";
import "./BookEdit.css";
import "./EditSheet.css";

type TabKey = "details" | "artwork" | "identifiers";

const TABS: { key: TabKey; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "artwork", label: "Artwork" },
  { key: "identifiers", label: "Identifiers" },
];

const tabId = (key: TabKey) => `es-tab-${key}`;
const panelId = (key: TabKey) => `es-panel-${key}`;

/** Details, Artwork and Identifiers: arrow keys move between them, and a dot marks a tab holding edits. */
function SheetTabs({
  tab,
  edited,
  hidden,
  onSelect,
}: {
  tab: TabKey;
  edited: Record<TabKey, boolean>;
  /** The fetch view has taken the tabs' place. */
  hidden: boolean;
  onSelect: (tab: TabKey) => void;
}) {
  const onKeyDown = (event: KeyboardEvent) => {
    const at = TABS.findIndex((t) => t.key === tab);
    const next =
      event.key === "ArrowRight"
        ? at + 1
        : event.key === "ArrowLeft"
          ? at - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? TABS.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    const to = TABS[(next + TABS.length) % TABS.length];
    if (!to) return;
    onSelect(to.key);
    document.getElementById(tabId(to.key))?.focus();
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a tablist has no native element
    <div
      className="es-tabs"
      role="tablist"
      aria-label="Book information"
      tabIndex={-1}
      hidden={hidden}
      onKeyDown={onKeyDown}
    >
      {TABS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          role="tab"
          id={tabId(key)}
          className="es-tab"
          aria-selected={tab === key}
          aria-controls={panelId(key)}
          tabIndex={tab === key ? 0 : -1}
          data-edited={edited[key] ? "" : undefined}
          onClick={() => onSelect(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** The identifiers the file carries, as they are written; a scheme it didn't name reads "Type unknown". */
function IdentifiersPanel({
  identifiers,
}: {
  identifiers: EditableBook["identifiers"];
}) {
  if (identifiers.length === 0) {
    return <p className="es-quiet">This book carries no identifiers.</p>;
  }
  return (
    <dl className="es-idents" data-testid="es-identifiers">
      {identifiers.map((ident, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the same value can be listed under two schemes, and the list is read-only
        <div key={i}>
          <dt>{ident.scheme?.trim() || "Type unknown"}</dt>
          <dd>{ident.value}</dd>
        </div>
      ))}
    </dl>
  );
}

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
  const form = useForm<MetaForm>({
    resolver: zodResolver(editFormSchema(book.form)),
    defaultValues: book.form,
    // A refused value says so as it is typed, and Done waits on it.
    mode: "onChange",
  });
  const [tab, setTab] = useState<TabKey>("details");
  // The book as the server last reported it, which putting the scanned cover back moves; `book.form` stays the baseline.
  const [live, setLive] = useState(book);
  // A cover picked or fetched waits here for Done, like the fields.
  const [held, setHeld] = useState<HeldCover | null>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [confirmingRevert, setConfirmingRevert] = useState(false);
  const [fetching, setFetching] = useState(false);
  // Shown only once a provider is set up to answer.
  const providers = useQuery(hasProviderQuery);

  const dirty = dirtyLabels(book.form, form.watch());
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
  const requestClose = () => (count > 0 ? setAsking(true) : close());

  const save = useMutation({
    mutationFn: async ({ values }: { values: MetaForm; changes: number }) => {
      await saveOverrides(book.uuid, overridesFrom(book.form, values));
      if (held?.source.kind === "file") {
        await uploadCover(book.uuid, held.source.file);
      } else if (held) {
        await coverFromUrl(book.uuid, held.source.url);
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

  // Fields first: a refused value is on Details, and its input is where the reader goes next.
  const showInvalid = (errors: FieldErrors<MetaForm>) => {
    flushSync(() => setTab("details"));
    const first = Object.keys(errors)[0] as keyof MetaForm | undefined;
    if (first) form.setFocus(first);
  };
  const submit = () => {
    revert.reset();
    void form.handleSubmit(
      (values) => save.mutate({ values, changes: count }),
      showInvalid,
    )();
  };
  const done = () => (count === 0 ? close() : submit());
  const discard = () => {
    save.reset();
    form.reset(book.form);
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
  // The fetch view hands back: to Details with the edited fields in view, or to Artwork for a cover alone.
  const applied = (to: TabKey, field: string | null) => {
    flushSync(() => {
      setFetching(false);
      setTab(to);
    });
    document.getElementById(field ?? "")?.scrollIntoView({
      block: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  };

  return (
    <Sheet
      label={`Edit ${book.displayTitle}`}
      testId="edit-sheet"
      onDismiss={requestClose}
      closing={closing}
      onClosed={leave}
      busy={saving}
      fallbackFocus={moreButton}
    >
      <div className="es-sheet">
        <SheetHead
          cover={shown}
          title={values.title}
          author={values.authors[0] ?? ""}
          fetch={
            providers.data ? (
              <Button
                className="es-fetch-open"
                data-testid="es-fetch"
                aria-expanded={fetching}
                disabled={locked}
                onClick={() => setFetching(!fetching)}
              >
                <SparkleGlyph />
                Fetch metadata
              </Button>
            ) : undefined
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
        <div className="es-body">
          {fetching && (
            <FetchView
              form={form}
              hasCover={live.coverUrl !== null || held !== null}
              onHoldCover={(url) => {
                releaseHeld(held);
                setHeld({ source: { kind: "url", url }, preview: url });
              }}
              onBack={() => setFetching(false)}
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
          invalid={invalid}
          error={save.error?.message}
          leaving={leaving}
          onDone={done}
          onDiscard={discard}
          onKeepEditing={() => {
            setAsking(false);
            if (blocker.state === "blocked") blocker.reset();
          }}
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

function Panel({
  tab,
  current,
  fetching,
  children,
}: {
  tab: TabKey;
  current: TabKey;
  fetching: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="es-panel"
      role="tabpanel"
      id={panelId(tab)}
      aria-labelledby={tabId(tab)}
      hidden={fetching || tab !== current}
    >
      {children}
    </div>
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
