/** The release this bundle was built for (`v0.8.9`), or `dev` for a local build. */
declare const __APP_VERSION__: string;

/** The camera scanner's glue (`src/vendor/barcode/`): what it adds to `window`, and the callbacks it calls. */
interface Window {
  OmnibusScanner?: {
    start(videoId: string, options: { wasmUrl: string }): Promise<void>;
    stop(): void;
    setTorch(on: boolean): void;
  };
  ZXingWASM?: object;
  __omnibusOnScanStatus?: (state: string) => void;
  __omnibusOnScanTorch?: (flag: string) => void;
  __omnibusOnScanResult?: (text: string) => void;
  /** hls.js (`src/vendor/hls/`): the global its script adds. */
  Hls?: import("./playback/loadHls").HlsConstructor;
}

/** The EPUB and PDF reader glues (`src/vendor/reader/`): what they add to `window`, and the callbacks they call with a JSON string. */
interface Window {
  JSZip?: unknown;
  ePub?: unknown;
  OmnibusReader?: {
    init(
      elementId: string,
      fileUrl: string,
      opts: {
        fontSize: number;
        fontFamily: string | null;
        lineHeight: string;
        maxWidth: string;
        justify: boolean;
        spread: string;
        cfi: string | null;
        theme: string;
        fontsHref: string;
        locationsKey: string;
      },
    ): void;
    next(): void;
    prev(): void;
    retry(): void;
    destroy(): void;
    setFontSize(px: number): void;
    setTheme(name: string): void;
    setFont(family: string | null): void;
    setLineHeight(value: string): void;
    setMargins(maxWidth: string): void;
    setJustify(on: boolean): void;
    setSpread(mode: string): void;
    addAnnotation(cfiRange: string, color: string): void;
    removeAnnotation(cfiRange: string): void;
    display(target: string): void;
    displayCfi(cfi: string): void;
    displayPercentage(pct: number): void;
    copyText(text: string): void;
    shareText(text: string): void;
    search(query: string): void;
  };
  OmnibusPdfReader?: {
    init(
      hostId: string,
      opts: {
        url: string;
        pdfjs: string;
        worker: string;
        wasmUrl: string;
        startPage: number;
        fit: "width" | "height";
      },
    ): void;
    retry(): void;
    destroy(): void;
    goTo(page: number): void;
    next(): void;
    prev(): void;
    setFit(mode: "width" | "height"): void;
    paintHighlights(list: { anchor: string; color: string }[]): void;
    clearSelection(): void;
    copyText(text: string): void;
    shareText(text: string): void;
  };
  __omnibusOnRelocate?: (json: string) => void;
  __omnibusOnStatus?: (json: string) => void;
  __omnibusOnSelection?: (json: string) => void;
  __omnibusOnSelectionCleared?: (json: string) => void;
  __omnibusOnToc?: (json: string) => void;
  __omnibusOnSearchResults?: (json: string) => void;
  __omnibusOnToggleChrome?: (json: string) => void;
  __omnibusOnPdfReady?: (json: string) => void;
  __omnibusOnPdfPage?: (json: string) => void;
  __omnibusOnPdfError?: (json: string) => void;
  __omnibusOnPdfSelection?: (json: string) => void;
  __omnibusOnPdfSelectionCleared?: (json: string) => void;
  __omnibusOnPdfHighlightTap?: (json: string) => void;
}
