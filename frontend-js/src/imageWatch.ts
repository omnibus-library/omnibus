/**
 * Stamps `data-loaded` on every image as it loads, which is what stops
 * Loading.css's cover glint. Capture phase, because `load` doesn't bubble;
 * the Dioxus BootScript does the same.
 */
export function watchImageLoads(target: Document = document): void {
  target.addEventListener(
    "load",
    (event) => {
      if (event.target instanceof HTMLImageElement) {
        event.target.setAttribute("data-loaded", "");
      }
    },
    true,
  );
}
