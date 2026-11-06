import type { Wash } from "./quoteColor";
import {
  collapse,
  type FontKey,
  passageSize,
  type Ratio,
  type SizeKey,
  wrapLines,
} from "./quoteStyle";

/** Everything the canvas needs to draw one card. */
export type CardDrawing = {
  text: string;
  author: string;
  subtitle: string;
  wash: Wash;
  ratio: Ratio;
  font: FontKey;
  size: SizeKey;
  bold: boolean;
  italic: boolean;
};

type Face = { primary: string; stack: string };

// The canvas mirrors of the editor's typeface tokens: the one family
// `document.fonts.load` is asked for, and the stack the canvas draws with.
const FACES = {
  serif: {
    primary: "'Cormorant Garamond'",
    stack: "'Cormorant Garamond', 'EB Garamond', Georgia, serif",
  },
  sans: {
    primary: "'Instrument Sans'",
    stack: "'Instrument Sans', ui-sans-serif, system-ui, sans-serif",
  },
  mono: {
    primary: "'Space Mono'",
    stack: "'Space Mono', ui-monospace, monospace",
  },
} satisfies Record<FontKey, Face>;

// The sans of the author and the mark, the display serif of the title.
const SANS = FACES.sans;
const DISPLAY = FACES.serif;

/** The card's width in pixels; every other measure is a fraction of it. */
export const CARD_WIDTH = 1080;

const HEIGHTS = {
  "1:1": 1080,
  "4:5": 1350,
  "3:4": 1440,
  "9:16": 1920,
} satisfies Record<Ratio, number>;

/** The exported card's size in pixels. */
export const cardSize = (ratio: Ratio) =>
  ({ width: CARD_WIDTH, height: HEIGHTS[ratio] }) as const;

const FILENAME = "omnibus-quote.png";
const DEFAULT_ANGLE = 135;
// The face's natural line height, and the extra the passage adds between its lines.
const LINE_HEIGHT = 1.2;
const LINE_GAP = 0.34;

const fontSpec = (
  px: number,
  family: string,
  weight: number,
  italic: boolean,
) => `${italic ? "italic " : ""}${weight} ${px}px ${family}`;

const passageFont = (card: CardDrawing, px: number) =>
  fontSpec(px, FACES[card.font].stack, card.bold ? 700 : 400, card.italic);

/** Resolves every face a draw uses, so measuring wraps against the right metrics. A failure still draws. */
export async function loadFaces(card: CardDrawing) {
  const face = FACES[card.font];
  await Promise.all([
    document.fonts.load(
      fontSpec(32, face.primary, card.bold ? 700 : 400, card.italic),
    ),
    document.fonts.load(fontSpec(32, SANS.primary, 600, false)),
    document.fonts.load(fontSpec(32, DISPLAY.primary, 400, true)),
  ]).catch(() => {});
}

// Canvas letter-spacing is missing from some browsers, which then draw untracked.
function setTracking(ctx: CanvasRenderingContext2D, px: number) {
  ctx.letterSpacing = `${px}px`;
}

function paintWash(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  wash: Wash,
) {
  // CSS's gradient line: through the centre, long enough that the corners take the end stops.
  const angle = ((wash.angle ?? DEFAULT_ANGLE) * Math.PI) / 180;
  const [dx, dy] = [Math.sin(angle), -Math.cos(angle)];
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const gradient = ctx.createLinearGradient(
    w / 2 - dx * half,
    h / 2 - dy * half,
    w / 2 + dx * half,
    h / 2 + dy * half,
  );
  gradient.addColorStop(0, wash.from);
  gradient.addColorStop(1, wash.to);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}

type Ink = { ctx: CanvasRenderingContext2D; color: string };

function fillLine(
  { ctx, color }: Ink,
  value: string,
  x: number,
  lineTop: number,
  px: number,
  alpha: number,
) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fillText(value, x, lineTop + (px * LINE_HEIGHT) / 2);
  ctx.globalAlpha = 1;
}

// Paints the rule, author, title and mark; returns the footer's top edge.
function paintFooter(ink: Ink, card: CardDrawing, w: number, h: number) {
  const { ctx } = ink;
  const pad = w * 0.094;
  const markPx = w * 0.021;
  const markTracking = w * 0.006;
  const authorPx = w * 0.026;
  const titlePx = w * 0.033;
  const author = card.author.trim().toUpperCase();
  const ruleH = Math.max(1, w * 0.004);

  ctx.font = fontSpec(markPx, SANS.stack, 600, false);
  setTracking(ctx, markTracking);
  const markW = ctx.measureText("OMNIBUS").width;
  setTracking(ctx, 0);

  ctx.font = fontSpec(titlePx, DISPLAY.stack, 400, true);
  const title = collapse(card.subtitle);
  // Wrapped short of the mark, so the two never overlap.
  const titleLines = title
    ? wrapLines(
        (t) => ctx.measureText(t).width,
        title,
        w - pad * 2 - markW - w * 0.03,
        2,
      )
    : [];

  const authorBlock = author ? authorPx * LINE_HEIGHT : 0;
  const titleBlock = titleLines.length * titlePx * LINE_HEIGHT;
  const below =
    author || titleLines.length
      ? w * 0.042 +
        authorBlock +
        (author && titleLines.length ? w * 0.012 : 0) +
        titleBlock
      : 0;
  const top = h - pad - ruleH - below;

  ctx.textBaseline = "middle";
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = ink.color;
  ctx.fillRect(pad, top, w * 0.14, ruleH);
  ctx.globalAlpha = 1;

  let y = top + ruleH + w * 0.042;
  if (author) {
    ctx.font = fontSpec(authorPx, SANS.stack, 600, false);
    setTracking(ctx, w * 0.0036);
    fillLine(ink, author, pad, y, authorPx, 0.75);
    setTracking(ctx, 0);
    y += authorBlock + w * 0.012;
  }
  ctx.font = fontSpec(titlePx, DISPLAY.stack, 400, true);
  for (const line of titleLines) {
    fillLine(ink, line, pad, y, titlePx, 0.62);
    y += titlePx * LINE_HEIGHT;
  }

  ctx.font = fontSpec(markPx, SANS.stack, 600, false);
  setTracking(ctx, markTracking);
  ctx.textAlign = "right";
  // The trailing tracking is part of the measured advance; add it back so the ink meets the padding.
  fillLine(
    ink,
    "OMNIBUS",
    w - pad + markTracking,
    h - pad - markPx * LINE_HEIGHT,
    markPx,
    0.34,
  );
  ctx.textAlign = "left";
  setTracking(ctx, 0);
  return top;
}

// Paints the watermark and passage as one group centred above the footer.
function paintPassage(
  ink: Ink,
  card: CardDrawing,
  w: number,
  footerTop: number,
) {
  const { ctx } = ink;
  const pad = w * 0.094;
  const passage = collapse(card.text);
  const px = passageSize(passage.length, card.size) * w;
  const advance = px * (LINE_HEIGHT + LINE_GAP);
  const region = footerTop - w * 0.03 - pad;

  // Sized before centring, so the watermark's bottom clears the first line.
  ctx.font = passageFont(card, w * 0.3);
  // The bounding box is measured from the baseline in force, so fix it before measuring.
  ctx.textBaseline = "alphabetic";
  const mark = ctx.measureText("“");
  const markInk = mark.actualBoundingBoxAscent + mark.actualBoundingBoxDescent;
  const gap = w * 0.012;

  const maxLines = Math.max(
    1,
    Math.floor((region - markInk - gap + px * LINE_GAP) / advance),
  );
  ctx.font = passageFont(card, px);
  const lines = wrapLines(
    (t) => ctx.measureText(t).width,
    passage,
    w - pad * 2,
    maxLines,
  );
  const group = markInk + gap + lines.length * advance - px * LINE_GAP;
  const top = pad + Math.max(0, (region - group) / 2);

  ctx.font = passageFont(card, w * 0.3);
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = ink.color;
  ctx.fillText("“", pad - w * 0.035, top + mark.actualBoundingBoxAscent);
  ctx.globalAlpha = 1;

  ctx.font = passageFont(card, px);
  ctx.textBaseline = "middle";
  lines.forEach((line, i) => {
    fillLine(ink, line, pad, top + markInk + gap + i * advance, px, 1);
  });
}

/** Paints the card onto `canvas` at export size; false when the canvas has no 2D context. */
export function paintQuoteCard(canvas: HTMLCanvasElement, card: CardDrawing) {
  const { width, height } = cardSize(card.ratio);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  paintWash(ctx, width, height, card.wash);
  const ink = { ctx, color: card.wash.ink };
  ctx.textAlign = "left";
  const footerTop = paintFooter(ink, card, width, height);
  paintPassage(ink, card, width, footerTop);
  return true;
}

/** Draws the card on an offscreen canvas, or returns `null` when there is no 2D context. */
export async function drawQuoteCanvas(
  card: CardDrawing,
): Promise<HTMLCanvasElement | null> {
  await loadFaces(card);
  const canvas = document.createElement("canvas");
  return paintQuoteCard(canvas, card) ? canvas : null;
}

async function renderPng(card: CardDrawing): Promise<Blob | null> {
  const canvas = await drawQuoteCanvas(card);
  return (
    canvas && new Promise((resolve) => canvas.toBlob(resolve, "image/png"))
  );
}

function download(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = FILENAME;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Saves the card as a PNG download. */
export async function exportQuoteCard(card: CardDrawing) {
  const blob = await renderPng(card);
  if (blob) download(blob);
}

/** Opens the share sheet with the card as a PNG; a browser that can't share files downloads it. */
export async function shareQuoteCard(card: CardDrawing) {
  const blob = await renderPng(card);
  if (!blob) return;
  const file = new File([blob], FILENAME, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    // A dismissed sheet rejects; that is the reader's choice, not a failure.
    await navigator
      .share({ files: [file], title: card.subtitle || "Quote" })
      .catch(() => {});
    return;
  }
  download(blob);
}

/** Copies the card to the clipboard as a PNG; where that is refused, it downloads instead. */
export async function copyQuoteCardImage(card: CardDrawing) {
  const blob = await renderPng(card);
  if (!blob) return;
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  } catch {
    download(blob);
  }
}
