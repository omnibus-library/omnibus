import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import "./Toast.css";

export type ToastAction = { label: string; onClick: () => void };

type Showing = { message: string; action?: ToastAction };

type Show = (message: string, action?: ToastAction) => void;

/** How long a plain toast stays, and how long its fade-out takes before the words go. */
const STAY_MS = 2600;
const FADE_MS = 450;

const ToastContext = createContext<Show | null>(null);

/** Shows `message`, replacing any toast on screen; one with an action stays until dismissed or replaced by another with one, and a plain toast waits behind it. */
export function useToast(): Show {
  const show = useContext(ToastContext);
  if (!show) throw new Error("toast used outside ToastProvider");
  return show;
}

/** Owns the one toast on screen: a status pill at the bottom centre. */
export function ToastProvider({ children }: { children: ReactNode }) {
  // What the pill says, kept while it fades out; a new object restarts the clock even for the same words.
  const [showing, setShowing] = useState<Showing | null>(null);
  const [on, setOn] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  // Whether an action toast is up, and the plain toasts held back behind it.
  const pending = useRef(false);
  const waiting = useRef<string[]>([]);
  // Where focus was before an action toast took it.
  const returnTo = useRef<HTMLElement | null>(null);
  const show = useCallback<Show>((message, action) => {
    if (!action && pending.current) {
      waiting.current.push(message);
      return;
    }
    pending.current = action !== undefined;
    setShowing({ message, action });
    setOn(true);
  }, []);
  const dismiss = useCallback(() => {
    pending.current = false;
    setOn(false);
  }, []);
  useEffect(() => {
    if (!showing) return;
    if (!on) {
      const gone = setTimeout(() => {
        const next = waiting.current.shift();
        if (next === undefined) return setShowing(null);
        setShowing({ message: next });
        setOn(true);
      }, FADE_MS);
      return () => clearTimeout(gone);
    }
    if (showing.action) return;
    const hide = setTimeout(dismiss, STAY_MS);
    return () => clearTimeout(hide);
  }, [showing, on, dismiss]);
  // An action toast takes focus, so its Undo is where the reader is; it gives focus back when it goes.
  useEffect(() => {
    if (!showing?.action || !on) return;
    const from = document.activeElement;
    if (from instanceof HTMLElement && !root.current?.contains(from)) {
      returnTo.current = from;
    }
    root.current?.querySelector<HTMLElement>(".toast-action")?.focus();
  }, [showing, on]);
  useEffect(() => {
    const back = returnTo.current;
    if (on || !back) return;
    returnTo.current = null;
    const lost =
      document.activeElement === document.body ||
      root.current?.contains(document.activeElement);
    if (lost && back.isConnected) back.focus();
  }, [on]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* Always exposed, so the first toast's words arrive in a live region a screen reader already watches; only its buttons are put away while it fades. */}
      <div
        ref={root}
        className={on ? "toast is-on" : "toast"}
        data-actionable={showing?.action ? "" : undefined}
        role="status"
        aria-live="polite"
      >
        {showing && <span>{showing.message}</span>}
        {showing?.action && (
          <>
            <button
              type="button"
              className="toast-action"
              inert={!on}
              onClick={() => {
                dismiss();
                showing.action?.onClick();
              }}
            >
              {showing.action.label}
            </button>
            <button
              type="button"
              className="toast-dismiss"
              aria-label="Dismiss"
              inert={!on}
              onClick={dismiss}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </>
        )}
      </div>
    </ToastContext.Provider>
  );
}
