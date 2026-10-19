import glueUrl from "../../vendor/barcode/barcode-scanner-glue.js?url";
import wasmUrl from "../../vendor/barcode/zxing_reader.wasm?url";
import zxingUrl from "../../vendor/barcode/zxing-reader.min.js?url";

// Loaded by <script>, not bundled: zxing's IIFE declares a global (`ZXingWASM`) the glue reads,
// which bundling would scope away.
const LOAD_TIMEOUT_MS = 10_000;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    // Ordered: the glue binds `ZXingWASM` when it starts.
    script.async = false;
    const timer = setTimeout(
      () => reject(new Error(`${src} did not load`)),
      LOAD_TIMEOUT_MS,
    );
    script.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`${src} failed to load`));
    };
    document.head.append(script);
  });
}

let loading: Promise<string> | undefined;

/** Loads zxing, then the glue, once per page; resolves to the wasm URL the glue must be started with. */
export function loadScanner(): Promise<string> {
  if (window.OmnibusScanner) return Promise.resolve(wasmUrl);
  loading ??= (window.ZXingWASM ? Promise.resolve() : loadScript(zxingUrl))
    .then(() => loadScript(glueUrl))
    .then(() => wasmUrl);
  // A failed load stays retryable.
  loading.catch(() => {
    loading = undefined;
  });
  return loading;
}
