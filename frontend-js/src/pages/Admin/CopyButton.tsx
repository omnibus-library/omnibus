import { useState } from "react";
import { Button } from "../../components/Button/Button";

type Outcome = "copied" | "failed";

/**
 * Copies `text`: the async Clipboard API where the page may use it, else a
 * selected textarea, since a plain-http LAN install is not a secure context.
 * Reports whether the copy landed.
 */
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Refused (no permission, no focus): the textarea below may still work.
    }
  }
  const previous = document.activeElement;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    // Left false: the feedback line tells the reader to copy it by hand.
  }
  area.remove();
  if (previous instanceof HTMLElement) previous.focus();
  return copied;
}

const FEEDBACK: Record<Outcome, string> = {
  copied: "Copied",
  failed: "Couldn’t copy. Select and copy it.",
};

/**
 * A button that copies `text`, followed by a status line for the outcome. The
 * line is in the DOM from the first paint, so the first outcome is announced
 * too; its test id is `{testId}-feedback`.
 */
export function CopyButton({
  text,
  label,
  testId,
}: {
  text: string;
  label: string;
  testId: string;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  return (
    <>
      <Button
        variant="ghost"
        data-testid={testId}
        onClick={async () =>
          setOutcome((await copyText(text)) ? "copied" : "failed")
        }
      >
        {label}
      </Button>
      <span
        role="status"
        className={
          outcome === "failed" ? "copy-feedback error" : "copy-feedback"
        }
        data-testid={`${testId}-feedback`}
      >
        {outcome && FEEDBACK[outcome]}
      </span>
    </>
  );
}
