import type { KeyboardEvent, MouseEvent } from "react";
import { classes } from "../../classes";

const SPOILER = "spoiler";
const SPOILER_TEXT = "spoiler-text";

// The sanitiser emits a spoiler as an inline `role="button"` span, which has no native
// activation. Revealing it also hands its text to assistive tech, which it hid until now.
function toggleSpoiler(spoiler: Element) {
  const revealed = spoiler.classList.toggle("revealed");
  spoiler.setAttribute("aria-expanded", String(revealed));
  const text = spoiler.querySelector(`:scope > .${SPOILER_TEXT}`);
  if (!text) return;
  if (revealed) {
    spoiler.removeAttribute("aria-label");
    text.removeAttribute("aria-hidden");
  } else {
    spoiler.setAttribute("aria-label", "Reveal spoiler");
    text.setAttribute("aria-hidden", "true");
  }
}

const spoilerOf = (event: { target: EventTarget }) =>
  event.target instanceof Element ? event.target.closest(`.${SPOILER}`) : null;

// One handler per body, delegated: the spoilers are inside server-rendered HTML.
const revealOnClick = (event: MouseEvent) => {
  const spoiler = spoilerOf(event);
  if (spoiler) toggleSpoiler(spoiler);
};

const revealOnKey = (event: KeyboardEvent) => {
  const spoiler = spoilerOf(event);
  if (
    (event.key !== "Enter" && event.key !== " ") ||
    !spoiler?.matches('[role="button"]')
  )
    return;
  // Space would scroll the page.
  event.preventDefault();
  toggleSpoiler(spoiler);
};

type RenderedMarkdownProps = {
  /** The server's sanitised HTML; `null` until the server has rendered `md`. */
  html: string | null;
  md: string;
  className?: string;
  testId?: string;
};

/** Journal-pipeline Markdown as the server rendered it, with `||spoilers||` that reveal on a click or a key. */
export function RenderedMarkdown({
  html,
  md,
  className,
  testId,
}: RenderedMarkdownProps) {
  if (html === null) {
    // Shown as written until the server's rendering lands.
    return (
      <div
        className={classes("bd-journal-entry-body bd-md-raw", className)}
        data-testid={testId}
      >
        {md}
      </div>
    );
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: delegates to the spoilers inside the server-rendered body
    <div
      onClick={revealOnClick}
      onKeyDown={revealOnKey}
      className={classes("bd-journal-entry-body", className)}
      data-testid={testId}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: the server renders and sanitises journal markdown, as the Dioxus page relies on
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
