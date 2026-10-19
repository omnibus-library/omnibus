import { loadScript } from "../components/BarcodeScanner/loadScanner";
import hlsUrl from "../vendor/hls/hls.min.js?url";

export type HlsInstance = {
  loadSource(url: string): void;
  attachMedia(media: object): void;
  on(
    event: string,
    handler: (event: string, data: { fatal?: boolean }) => void,
  ): void;
};

export type HlsConstructor = {
  new (): HlsInstance;
  isSupported(): boolean;
  Events: { ERROR: string };
};

let loading: Promise<HlsConstructor> | undefined;

/** Loads the vendored hls.js once per page, by <script> as it declares a global; resolves to that global. */
export function loadHls(): Promise<HlsConstructor> {
  if (window.Hls) return Promise.resolve(window.Hls);
  loading ??= loadScript(hlsUrl).then(() => {
    if (!window.Hls) throw new Error("hls.js did not define Hls");
    return window.Hls;
  });
  // A failed load stays retryable.
  loading.catch(() => {
    loading = undefined;
  });
  return loading;
}
