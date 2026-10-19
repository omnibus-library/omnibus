import type { HttpHandler } from "msw";
import type {
  Bookmark,
  CrossFormatResume,
  Highlight,
  ProgressUpdate,
} from "../api/generated/schemas";
import { bookHandler, readStatusHandlers } from "./handlers";
import { fakeEpubGlue, fakePdfGlue } from "./readerGlue";
import {
  annotationHandlers,
  crossFormatHandlers,
  progressHandlers,
  type RecordedWrite,
} from "./readerHandlers";
import { aWireBook, aWirePosition, aWireReadStatus } from "./wire";

export const BOOK = aWireBook({ formats: ["EPUB"] });
export const UUID = BOOK.unique_identifier;
export const SAVED_CFI = "epubcfi(/6/14!/4/2/1:0)";
export const SAVED = aWirePosition({
  epub_cfi: SAVED_CFI,
  progress_percent: 30,
});
export const TOC = [
  { label: "Prologue", href: "prologue.xhtml", level: 0 },
  { label: "Landfall", href: "landfall.xhtml", level: 0 },
  { label: "The Long Dark", href: "dark.xhtml", level: 1 },
];

/**
 * What every EPUB reader story shares: the book saved at `SAVED`, the writes it records and the
 * stand-in glue, which `setup` installs for the story and `restore`s on its cleanup.
 */
export function readerFixture() {
  const writes: ProgressUpdate[] = [];
  const statusWrites: { status: string }[] = [];
  // The highlights and bookmarks the server holds (a story sets them) and the writes made against them.
  const annotations: { highlights: Highlight[]; bookmarks: Bookmark[] } = {
    highlights: [],
    bookmarks: [],
  };
  const annotationWrites: RecordedWrite[] = [];
  // What the cross-format resume route answers (a story sets it) and the calls made to it and the sync point.
  const crossFormat: { resume: CrossFormatResume } = {
    resume: { state: "not_linked" },
  };
  const syncCalls: RecordedWrite[] = [];
  let glue: ReturnType<typeof fakeEpubGlue>;

  function install(options?: Parameters<typeof fakeEpubGlue>[0]) {
    glue = fakeEpubGlue({ toc: TOC, ...options });
    return glue.restore;
  }

  return {
    writes,
    statusWrites,
    annotations,
    annotationWrites,
    crossFormat,
    syncCalls,
    install,
    get glue() {
      return glue;
    },
    inits: () => glue.calls.filter((c) => c.method === "init"),
    opens: () =>
      glue.calls.filter((c) => c.method === "init").map((c) => c.args[2]),
    setup(msw: { use(...handlers: HttpHandler[]): void }) {
      writes.length = 0;
      statusWrites.length = 0;
      annotations.highlights = [];
      annotations.bookmarks = [];
      annotationWrites.length = 0;
      crossFormat.resume = { state: "not_linked" };
      syncCalls.length = 0;
      // The reader keeps its position and typography here, which would otherwise carry between stories.
      localStorage.clear();
      msw.use(
        bookHandler(BOOK),
        ...progressHandlers([SAVED], writes),
        ...readStatusHandlers(aWireReadStatus(), statusWrites),
        ...annotationHandlers(annotations, annotationWrites),
        ...crossFormatHandlers(crossFormat, syncCalls),
      );
      return install();
    },
  };
}

export const PDF_BOOK = aWireBook({ formats: ["PDF"] });
export const PDF_UUID = PDF_BOOK.unique_identifier;
export const PDF_SAVED = aWirePosition({
  epub_cfi: "pdf-page:2",
  progress_percent: 60,
});

/** What every PDF reader story shares, as `readerFixture` does for EPUB: the book saved at `PDF_SAVED`, the writes it records and the stand-in glue. */
export function pdfFixture() {
  const writes: ProgressUpdate[] = [];
  const statusWrites: { status: string }[] = [];
  const annotations: { highlights: Highlight[]; bookmarks: Bookmark[] } = {
    highlights: [],
    bookmarks: [],
  };
  const annotationWrites: RecordedWrite[] = [];
  let glue: ReturnType<typeof fakePdfGlue>;

  function install(options?: Parameters<typeof fakePdfGlue>[0]) {
    glue = fakePdfGlue(options);
    return glue.restore;
  }

  return {
    writes,
    statusWrites,
    annotations,
    annotationWrites,
    install,
    get glue() {
      return glue;
    },
    inits: () => glue.argsOf("init"),
    goTos: () => glue.argsOf("goTo"),
    setup(msw: { use(...handlers: HttpHandler[]): void }) {
      writes.length = 0;
      statusWrites.length = 0;
      annotations.highlights = [];
      annotations.bookmarks = [];
      annotationWrites.length = 0;
      msw.use(
        bookHandler(PDF_BOOK),
        ...progressHandlers([PDF_SAVED], writes),
        ...readStatusHandlers(aWireReadStatus(), statusWrites),
        ...annotationHandlers(annotations, annotationWrites),
      );
      return install();
    },
  };
}
