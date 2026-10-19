import { useState } from "react";
import { classes } from "../../classes";
import { Button } from "../Button/Button";
import "./CopyButton.css";

type CopyOutcome = "copied" | "failed";

// A plain-http LAN install is not a secure context, so `navigator.clipboard` can be missing.
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Falls through to the selected-textarea copy.
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
    // Left false: the feedback says the copy failed.
  }
  area.remove();
  if (previous instanceof HTMLElement) previous.focus();
  return copied;
}

const FEEDBACK = {
  copied: "Copied",
  failed: "Couldn’t copy. Select and copy it.",
} satisfies Record<CopyOutcome, string>;

type CopyButtonProps = {
  text: string;
  label: string;
  /** The button's test id; its feedback is `{testId}-feedback`. */
  testId: string;
  ariaLabel?: string;
};

/** A button that copies `text`, then a live region saying whether it landed. */
export function CopyButton({
  text,
  label,
  testId,
  ariaLabel,
}: CopyButtonProps) {
  const [outcome, setOutcome] = useState<CopyOutcome | null>(null);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        data-testid={testId}
        aria-label={ariaLabel}
        onClick={async () =>
          setOutcome((await copyText(text)) ? "copied" : "failed")
        }
      >
        {label}
      </Button>
      {/* Mounted before the first copy, so that first outcome is announced. */}
      <span
        role="status"
        className={classes("copy-feedback", outcome === "failed" && "error")}
        data-testid={`${testId}-feedback`}
      >
        {outcome && FEEDBACK[outcome]}
      </span>
    </>
  );
}
