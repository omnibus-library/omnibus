import type { z } from "zod";

const LOAD_TIMEOUT_MS = 10_000;

/** Appends a classic `<script>` and settles when it loads, fails or takes over 10 s. */
export function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    // Ordered: a glue binds the global its runtime declared when it starts.
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

/** Parses a glue's JSON payload; vendor output is untrusted, so one that doesn't match the schema is dropped (`null`). */
export function parseWith<T>(schema: z.ZodType<T>, json: string): T | null {
  try {
    return schema.parse(JSON.parse(json));
  } catch {
    return null;
  }
}
