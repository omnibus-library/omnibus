import "@testing-library/jest-dom/vitest";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  localStorage.clear();
});

// jsdom lays nothing out, so it has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom plays no media; the player's calls on its <audio> do nothing here.
Object.assign(HTMLMediaElement.prototype, {
  load() {},
  pause() {},
  play: () => Promise.resolve(),
});
