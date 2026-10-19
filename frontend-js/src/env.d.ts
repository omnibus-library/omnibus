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
