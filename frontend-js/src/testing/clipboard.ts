/**
 * Replaces the browser's clipboard with one that records what it is asked to
 * write. Returns a function that restores the real one, for a story's `beforeEach` to return.
 */
export function fakeClipboard(copied: string[]) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        copied.push(text);
      },
    },
  });
  return () => {
    Reflect.deleteProperty(navigator, "clipboard");
  };
}
