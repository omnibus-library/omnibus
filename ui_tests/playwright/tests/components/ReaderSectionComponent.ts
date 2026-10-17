import type { FrameLocator, Locator, Page } from "@playwright/test";
import { EMBEDDED_FONT_FAMILY } from "../fixtures/epubs";
import { BaseComponent } from "./BaseComponent";

export type SectionFontState = {
  override: string | null;
  bodyInline: string;
  paragraphFamily: string;
  embeddedSrcs: string[];
  fontsHref: string | null;
  faces: { family: string; status: string }[];
};

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

  /**
   * The worst axis drift in px between the painted highlight marks and the
   * first paragraph's chars 10 to 24 (`MID_PARAGRAPH_RANGE`), or Infinity while
   * unmeasurable. It reads rendered prose on purpose: the defect is epub.js
   * painting marks at a stale layout's rects.
   */
  overlayDrift(): Promise<number> {
    return this.page.evaluate(() => {
      const view = document.querySelector("#omnibus-viewer .epub-view");
      const iframe = view?.querySelector("iframe");
      const rects = view
        ? Array.from(view.querySelectorAll(":scope > svg rect"))
        : [];
      const doc = iframe?.contentDocument;
      // The seeded range targets the <p> after the <h1>; mirror it exactly.
      const text = doc?.body?.querySelector("p")?.firstChild;
      if (
        !iframe ||
        !doc ||
        rects.length === 0 ||
        !text ||
        text.nodeType !== Node.TEXT_NODE
      ) {
        return Number.POSITIVE_INFINITY;
      }
      const range = doc.createRange();
      const len = (text as Text).data.length;
      range.setStart(text, Math.min(10, len));
      range.setEnd(text, Math.min(24, len));
      const t = range.getBoundingClientRect();
      const ifr = iframe.getBoundingClientRect();
      const union = rects
        .map((r) => r.getBoundingClientRect())
        .reduce(
          (a, b) => ({
            left: Math.min(a.left, b.left),
            top: Math.min(a.top, b.top),
          }),
          { left: Number.POSITIVE_INFINITY, top: Number.POSITIVE_INFINITY },
        );
      return Math.max(
        Math.abs(union.left - (t.left + ifr.left)),
        Math.abs(union.top - (t.top + ifr.top)),
      );
    });
  }

  /**
   * The section's typeface state, or null before it has a paragraph.
   * `override` is the reader's own font layer: "" under Original, where the
   * absence of a declaration is the contract. A rendered glyph proves little,
   * since a browser falls through from a refused `@font-face` to the next
   * copy, so `embeddedSrcs` lists every src declared for the embedded family
   * (a `blob:` among them is a copy CSP refuses) and `faces` each face's status.
   */
  fontState(): Promise<SectionFontState | null> {
    return this.page.evaluate((family: string) => {
      const iframe = document.querySelector<HTMLIFrameElement>(
        "#omnibus-viewer iframe",
      );
      const doc = iframe?.contentDocument;
      const p = doc?.body?.querySelector("p");
      if (!doc || !p) return null;

      const embeddedSrcs: string[] = [];
      for (const sheet of Array.from(doc.styleSheets)) {
        let rules: CSSRuleList | undefined;
        try {
          rules = sheet.cssRules;
        } catch {
          continue; // a sheet this document may not read
        }
        for (const rule of Array.from(rules ?? [])) {
          // Numeric type, not `instanceof CSSFontFaceRule`: the constructor in
          // this realm is not the one the iframe's rules were built with.
          if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
          const style = (rule as CSSFontFaceRule).style;
          const declared = style
            .getPropertyValue("font-family")
            .replace(/["']/g, "")
            .trim();
          if (declared !== family) continue;
          embeddedSrcs.push(style.getPropertyValue("src"));
        }
      }

      return {
        override: doc.getElementById("__omnibus_font")?.textContent ?? null,
        bodyInline: doc.body.style.fontFamily,
        paragraphFamily: getComputedStyle(p).fontFamily,
        embeddedSrcs,
        // The reader's own sheet, as the section actually received it.
        fontsHref:
          doc.getElementById("__omnibus_fonts")?.getAttribute("href") ?? null,
        faces: Array.from(doc.fonts).map((f) => ({
          family: f.family.replace(/["']/g, ""),
          status: f.status,
        })),
      };
    }, EMBEDDED_FONT_FAMILY);
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
