// A real `beforeunload` dispatched here would also reach Mock Service Worker's own listener, which
// retires the page's handlers for every story that follows. So the guards' listeners (named
// `warn`, in `Unsaved.tsx`) are tracked as they are added and asked directly with the event they
// would be given.
const listeners = new Set<EventListenerOrEventListenerObject>();
const { addEventListener, removeEventListener } = window;

const isGuard = (listener: EventListenerOrEventListenerObject) =>
  typeof listener === "function" && listener.name === "warn";

window.addEventListener = (
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
) => {
  if (type === "beforeunload" && isGuard(listener)) listeners.add(listener);
  addEventListener.call(window, type, listener, options);
};
window.removeEventListener = (
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | EventListenerOptions,
) => {
  if (type === "beforeunload") listeners.delete(listener);
  removeEventListener.call(window, type, listener, options);
};

/** Whether a tab close right now would be held back by a guard added since this module loaded. */
export function unloadPrevented() {
  const event = new Event("beforeunload", { cancelable: true });
  for (const listener of listeners) {
    if (typeof listener === "function") listener.call(window, event);
    else listener.handleEvent(event);
  }
  return event.defaultPrevented;
}
