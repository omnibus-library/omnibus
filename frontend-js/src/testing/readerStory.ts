import type { HttpHandler } from "msw";
import type { ProgressUpdate } from "../api/generated/schemas";
import { bookHandler, readStatusHandlers } from "./handlers";
import { fakeEpubGlue } from "./readerGlue";
import { progressHandlers } from "./readerHandlers";
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
  let glue: ReturnType<typeof fakeEpubGlue>;

  function install(options?: Parameters<typeof fakeEpubGlue>[0]) {
    glue = fakeEpubGlue({ toc: TOC, ...options });
    return glue.restore;
  }

  return {
    writes,
    statusWrites,
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
      // The reader keeps this device's last position here, which would otherwise carry between stories.
      localStorage.removeItem(`omn.reading::${UUID}`);
      msw.use(
        bookHandler(BOOK),
        ...progressHandlers([SAVED], writes),
        ...readStatusHandlers(aWireReadStatus(), statusWrites),
      );
      return install();
    },
  };
}
