import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
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

/** Shows `message`, replacing any toast on screen; one with an action stays until dismissed or replaced. */
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
  const show = useCallback<Show>((message, action) => {
    setShowing({ message, action });
    setOn(true);
  }, []);
  const dismiss = useCallback(() => setOn(false), []);
  useEffect(() => {
    if (!showing) return;
    if (!on) {
      const gone = setTimeout(() => setShowing(null), FADE_MS);
      return () => clearTimeout(gone);
    }
    if (showing.action) return;
    const hide = setTimeout(dismiss, STAY_MS);
    return () => clearTimeout(hide);
  }, [showing, on, dismiss]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        className={on ? "toast is-on" : "toast"}
        data-actionable={showing?.action ? "" : undefined}
        role="status"
        aria-live="polite"
        // Fading out, it is neither reachable nor read.
        inert={!on}
      >
        {showing && <span>{showing.message}</span>}
        {showing?.action && (
          <>
            <button
              type="button"
              className="toast-action"
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
