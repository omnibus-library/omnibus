import type { FrameLocator, Locator, Page } from "@playwright/test";
import { BaseComponent } from "./BaseComponent";

/**
 * The book's rendered section: the same-origin iframe epub.js paints into.
 * Specs reach EPUB content only through here.
 */
export class ReaderSectionComponent extends BaseComponent {
  readonly frameElement: Locator;
  readonly svgImage: Locator;

  private readonly content: FrameLocator;

  constructor(page: Page) {
    super(page);
    this.frameElement = page.locator("#omnibus-viewer iframe");
    this.content = this.frameElement.contentFrame();
    this.svgImage = this.content.locator("svg image");
  }

  /** The `<img>` whose alt text is `name`. */
  image(name: string): Locator {
    return this.content.getByRole("img", { name });
  }

  text(content: string): Locator {
    return this.content.getByText(content);
  }

  /** How many `blob:` stylesheets the section links; -1 before it exists. */
  blobStylesheetCount(): Promise<number> {
    return this.page.evaluate(() => {
      const iframe = document.querySelector<HTMLIFrameElement>(
        "#omnibus-viewer iframe",
      );
      const doc = iframe?.contentDocument;
      if (!doc) return -1;
      return Array.from(doc.querySelectorAll<HTMLLinkElement>("link")).filter(
        (l) => l.href.startsWith("blob:"),
      ).length;
    });
  }

  /**
   * Whether the prose on screen stays clear of both page-turn buttons, as a
   * sentence a failed poll can print. A page without a spread of prose on it
   * proves nothing, so it is not clear either.
   */
  async turnButtonClearance(): Promise<string> {
    const m = await this.page.evaluate(() => {
      const clip = document
        .querySelector("#omnibus-viewer")
        ?.getBoundingClientRect();
      const prev = document
        .querySelector("[data-testid=reader-prev]")
        ?.getBoundingClientRect();
      const next = document
        .querySelector("[data-testid=reader-next]")
        ?.getBoundingClientRect();
      const frame = document.querySelector<HTMLIFrameElement>(
        "#omnibus-viewer iframe",
      );
      const doc = frame?.contentDocument;
      if (!clip || !prev || !next || !frame || !doc?.body) return null;
      const off = frame.getBoundingClientRect();
      let left = Number.POSITIVE_INFINITY;
      let right = Number.NEGATIVE_INFINITY;
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!(n as Text).data.trim()) continue;
        const range = doc.createRange();
        range.selectNodeContents(n);
        for (const box of Array.from(range.getClientRects())) {
          const l = off.left + box.left;
          const r = off.left + box.right;
          // The rest of the section sits beside the page, clipped by the viewer.
          if (box.width === 0 || r <= clip.left || l >= clip.right) continue;
          left = Math.min(left, l);
          right = Math.max(right, r);
        }
      }
      return {
        underPrev: prev.right - left,
        underNext: right - next.left,
        span: (right - left) / clip.width,
      };
    });
    if (!m || !(m.span > 0.6)) return "no page of prose on screen";
    if (m.underPrev > 0) {
      return `prose runs ${Math.ceil(m.underPrev)}px under the previous-page button`;
    }
    if (m.underNext > 0) {
      return `prose runs ${Math.ceil(m.underNext)}px under the next-page button`;
    }
    return "clear";
  }
}
