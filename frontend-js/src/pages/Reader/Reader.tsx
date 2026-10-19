import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import {
  type BookUuid,
  type HighlightColor,
  parseBookUuid,
  saveReadingPosition,
} from "../../api";
import { useAutoReadStatus } from "../../autoReadStatus";
import { classes } from "../../classes";
import { PageNotFound } from "../../components/PageState/PageState";
import { useTheme } from "../../components/Theme/AtriumRoot";
import { useReadingSession } from "../../readingSession";
import {
  bookQuery,
  highlightsQuery,
  progressQuery,
} from "../BookDetail/queries";
import { AaPanel } from "./AaPanel";
import { AnnotationsSheet } from "./AnnotationsSheet";
import { AnnotationTargets } from "./AnnotationTargets";
import { epubBridge, useHighlights } from "./annotations";
import { BookmarksDrawer } from "./BookmarksDrawer";
import {
  loadEpubRuntime,
  type PassageSelection,
  parseRelocate,
  parseSearchResults,
  parseSelection,
  parseToc,
  type SearchResult,
  type TocEntry,
  withReader,
} from "./epubGlue";
import { HighlightsDrawer } from "./HighlightsDrawer";
import {
  Footer,
  PageTurnGutters,
  type Panel,
  TopBar,
  ViewerStage,
} from "./ReaderChrome";
import {
  applyGlueStatus,
  clearedByRelocate,
  formatAmbientPage,
  formatContentsProgress,
  formatProgressLabels,
  formatTitleSub,
  NO_LOCATION,
  type ReaderStatus,
  relocateWrite,
  resolveChapterPosition,
} from "./relocate";
import { SearchPanel } from "./SearchPanel";
import { SelectionPopover } from "./SelectionPopover";
import { SyncHerePill, SyncJumpBanner } from "./SyncBanner";
import {
  fileIdParam,
  furtherInPercent,
  isEpubCfi,
  loadLocalPosition,
  readerStart,
  saveLocalPosition,
} from "./start";
import { TocDrawer } from "./TocDrawer";
import {
  initOptions,
  loadReaderPrefs,
  type PrefName,
  pushReaderPref,
  type ReaderPrefs,
  saveReaderPref,
} from "./typography";
import "./Reader.css";

const VIEWER_ID = "omnibus-viewer";
const FONTS_HREF = `${import.meta.env.BASE_URL}reader-fonts/reader-fonts.css`;

// The glue calls these with a JSON string; each one this page bridges is listed here.
const HOOKS = [
  "__omnibusOnRelocate",
  "__omnibusOnStatus",
  "__omnibusOnToc",
  "__omnibusOnSearchResults",
  "__omnibusOnSelection",
  "__omnibusOnSelectionCleared",
  "__omnibusOnToggleChrome",
] as const;

function EpubPage({
  uuid,
  fileId,
  deepLink,
}: {
  uuid: BookUuid;
  fileId: number | null;
  deepLink: string | null;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { data: book } = useQuery(bookQuery(uuid));
  const surface = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<ReaderStatus>("loading");
  const [loc, setLoc] = useState(NO_LOCATION);
  const [chromeHidden, setChromeHidden] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  // Read at mount, so the first `init` already carries them.
  const [prefs, setPrefs] = useState(loadReaderPrefs);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selection, setSelection] = useState<PassageSelection | null>(null);
  const {
    highlights,
    listState,
    target,
    setTarget,
    load,
    create,
    saveNote,
    rowActions,
  } = useHighlights(uuid, epubBridge);
  // Retry re-runs the whole open: the fetch, the runtime load and the init.
  const [attempt, setAttempt] = useState(0);

  useReadingSession(uuid);
  useAutoReadStatus(uuid, loc.atEnd);

  // The glue is opened after async fetches, so it reads what the reader holds then, not at mount.
  const latest = useRef({ prefs, theme });
  latest.current = { prefs, theme };

  useEffect(() => surface.current?.focus(), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry bumps `attempt` to run the open again, and a theme or typography change reaches the glue through its setters
  useEffect(() => {
    let cancelled = false;
    // Per mount: the last position posted (not the last seen), whether the first landing is held, and the TOC.
    let lastPosted: string | null = null;
    let hold = false;
    let tocNow: TocEntry[] = [];
    let chapter = 0;
    setStatus("loading");

    const hooks = {
      __omnibusOnRelocate(json: string) {
        const data = parseRelocate(json);
        if (!data) return;
        const [here, totalChapters] = resolveChapterPosition(
          tocNow,
          data,
          chapter,
        );
        chapter = here;
        const write = relocateWrite(data.cfi, data.echo, lastPosted, hold);
        ({ lastPosted, hold } = write);
        if (write.post) {
          saveLocalPosition(uuid, write.post);
          // Best-effort: a failed write must not interrupt reading, and the next turn retries.
          saveReadingPosition(uuid, {
            anchor: write.post,
            percent: Math.min(data.pct, 100),
          }).catch(() => {});
        }
        setStatus((s) => (clearedByRelocate(s) ? "ready" : s));
        setLoc({ ...data, chapter: here, totalChapters });
      },
      __omnibusOnStatus: (state: string) =>
        setStatus((s) => applyGlueStatus(s, state)),
      __omnibusOnToc(json: string) {
        tocNow = parseToc(json) ?? tocNow;
        setToc(tocNow);
      },
      __omnibusOnSearchResults(json: string) {
        const found = parseSearchResults(json);
        if (found) setResults(found);
        setSearching(false);
      },
      __omnibusOnSelection(json: string) {
        const picked = parseSelection(json);
        if (picked) setSelection(picked);
      },
      // The only dismiss on phones, where the popover has no scrim to tap.
      __omnibusOnSelectionCleared: () => setSelection(null),
      __omnibusOnToggleChrome: () => setChromeHidden((hidden) => !hidden),
    } satisfies Record<(typeof HOOKS)[number], (json: string) => void>;
    for (const name of HOOKS) window[name] = hooks[name];

    const open = async () => {
      // Started now, beside the progress fetch.
      const runtime = loadEpubRuntime().then(
        () => true,
        () => false,
      );
      // A failed fetch fails the open: it must not read as "nothing saved" and write over the real position.
      const record =
        deepLink !== null
          ? null
          : (await client.fetchQuery({ ...progressQuery(uuid), staleTime: 0 }))
              .reading;
      if (cancelled) return;
      // Until the first relocate the footer shows the stored percent, marked approximate.
      const pct = furtherInPercent(record);
      if (pct !== null) {
        setLoc((now) =>
          now.cfi === null ? { ...NO_LOCATION, pct, pctApprox: true } : now,
        );
      }
      const start = readerStart(deepLink, record, loadLocalPosition(uuid));
      hold = start.holdFirstWrite;
      const loaded = await runtime;
      if (cancelled) return;
      if (!loaded) return setStatus("failed");
      const url = `/api/ebooks/${encodeURIComponent(uuid)}/file`;
      window.OmnibusReader?.init(
        VIEWER_ID,
        fileId === null ? url : `${url}?file_id=${fileId}`,
        {
          ...initOptions(latest.current.prefs),
          cfi: start.cfi,
          theme: latest.current.theme,
          fontsHref: FONTS_HREF,
          locationsKey: uuid,
        },
      );
      const saved = await client
        .fetchQuery({ ...highlightsQuery(uuid), staleTime: 0 })
        .catch(() => null);
      if (!cancelled) load(saved);
    };
    open().catch(() => {
      if (!cancelled) setStatus("failed");
    });

    return () => {
      cancelled = true;
      for (const name of HOOKS) {
        if (window[name] === hooks[name]) delete window[name];
      }
      window.OmnibusReader?.destroy();
    };
  }, [client, uuid, fileId, deepLink, attempt]);

  useEffect(() => withReader((glue) => glue.setTheme(theme)), [theme]);

  const back = () => navigate(`/books/${uuid}`, { replace: true });
  const turn = (direction: "prev" | "next") => {
    setSelection(null);
    withReader((glue) => glue[direction]());
  };
  // Opening a tool closes whatever else is open.
  const toggle = (tool: Panel) => {
    setTarget(null);
    setPanel((open) => (open === tool ? null : tool));
  };
  function changePref<K extends PrefName>(name: K, value: ReaderPrefs[K]) {
    const next = { ...prefs, [name]: value };
    setPrefs(next);
    withReader((glue) => pushReaderPref(glue, name, next));
    saveReaderPref(name, next);
  }
  const jumpTo = (target: string) => {
    withReader((glue) => glue.display(target));
    setPanel(null);
  };

  const highlightSelection = (
    picked: PassageSelection,
    color: HighlightColor,
    after: "note" | "quote" | null,
  ) => {
    setSelection(null);
    create({ anchor: picked.cfiRange, color, text: picked.text }, after);
  };
  const rows = rowActions(
    () => setPanel(null),
    () => surface.current?.focus(),
  );

  const labels = formatProgressLabels(loc);
  // While a jump is in flight the outgoing chapter is blanked rather than shown stale.
  const jumping = status === "loading";
  const chapterTitle = jumping ? "" : loc.chapterTitle;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the reader takes arrow keys while it holds focus
    <div
      ref={surface}
      className={classes("rd-surface", chromeHidden && "rd-chrome-hidden")}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focus lands here so the arrow keys work at once
      tabIndex={0}
      onKeyDown={(e) => {
        // An input inside the surface keeps its arrow keys.
        const typing =
          e.target instanceof HTMLElement &&
          e.target.closest("input, textarea");
        if (e.key === "Escape") {
          if (selection) setSelection(null);
          else if (target) setTarget(null);
          else if (panel) setPanel(null);
          else back();
        } else if (typing) return;
        else if (e.key === "ArrowLeft") turn("prev");
        else if (e.key === "ArrowRight") turn("next");
        else return;
        e.preventDefault();
      }}
    >
      {/* Without `precedence`: React holds a hoisted sheet's page back until it loads, which jsdom never reports. */}
      <link rel="stylesheet" href={FONTS_HREF} />
      <div className="rd-wash" />
      {/* Mirrors the toolbar title where the toolbar was, while the phone chrome is hidden. */}
      <div className="rd-ambient-title" aria-hidden="true">
        {book?.title}
      </div>
      <TopBar
        bookTitle={book?.title ?? ""}
        chapterTitle={chapterTitle}
        titleSub={jumping ? "" : formatTitleSub(loc)}
        panel={panel}
        highlightCount={highlights.length}
        onBack={back}
        onToggle={toggle}
      />
      {deepLink === null && <SyncJumpBanner uuid={uuid} />}
      <ViewerStage status={status} onRetry={() => setAttempt((n) => n + 1)} />
      <PageTurnGutters
        onPrev={() => turn("prev")}
        onNext={() => turn("next")}
      />
      <Footer
        page={labels.page}
        pill={<SyncHerePill uuid={uuid} loc={loc} />}
        chapter={labels.chapter}
        ambient={formatAmbientPage(loc)}
        pct={loc.pct}
      />
      {selection && (
        <SelectionPopover
          rect={selection.rect}
          onDismiss={() => setSelection(null)}
          onHighlight={(color) => highlightSelection(selection, color, null)}
          onNote={() => highlightSelection(selection, "amber", "note")}
          onQuote={() => highlightSelection(selection, "amber", "quote")}
          onCopy={() => {
            epubBridge.copy(selection.text);
            setSelection(null);
          }}
          onShare={() => {
            withReader((glue) => glue.shareText(selection.text));
            setSelection(null);
          }}
        />
      )}
      {panel === "aa" && (
        <AaPanel
          prefs={prefs}
          onChange={changePref}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "toc" && (
        <TocDrawer
          entries={toc}
          currentTitle={chapterTitle}
          progressLabel={formatContentsProgress(loc)}
          onNavigate={(href) => {
            // Blank the outgoing chapter until the relocate that confirms the jump.
            setStatus("loading");
            jumpTo(href);
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "highlights" && (
        <HighlightsDrawer
          highlights={highlights}
          listState={listState}
          {...rows}
        />
      )}
      {panel === "bookmarks" && (
        <BookmarksDrawer
          uuid={uuid}
          position={loc.cfi}
          label={chapterTitle}
          bridge={epubBridge}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === "annotations" && (
        <AnnotationsSheet
          uuid={uuid}
          position={loc.cfi}
          label={chapterTitle}
          highlights={highlights}
          listState={listState}
          {...rows}
        />
      )}
      {panel === "search" && (
        <SearchPanel
          results={results}
          searching={searching}
          onQuery={(query) => {
            setSearching(true);
            withReader((glue) => glue.search(query));
          }}
          onNavigate={jumpTo}
          onClose={() => setPanel(null)}
        />
      )}
      <AnnotationTargets
        target={target}
        book={book}
        onSave={saveNote}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}

export function Reader() {
  const uuid = parseBookUuid(useParams().uuid);
  const [search] = useSearchParams();
  const fileId = fileIdParam(search);
  // `?cfi=` is a CFI only when it says so: a PDF highlight's link carries a `pdf:` anchor.
  const cfi = search.get("cfi");
  const deepLink = cfi !== null && isEpubCfi(cfi) ? cfi : null;
  if (!uuid) return <PageNotFound subject="Book" />;
  return (
    <EpubPage
      key={`${uuid}|${fileId}|${deepLink}`}
      uuid={uuid}
      fileId={fileId}
      deepLink={deepLink}
    />
  );
}
