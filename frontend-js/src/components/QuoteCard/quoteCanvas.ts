import type { FontKey, Ratio, SizeKey } from "./quoteStyle";

/** Everything the canvas needs to draw one card. */
export type CardDrawing = {
  text: string;
  author: string;
  subtitle: string;
  bg: string;
  ink: string;
  ratio: Ratio;
  font: FontKey;
  size: SizeKey;
  bold: boolean;
  italic: boolean;
};

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
} satisfies Record<FontKey, { primary: string; stack: string }>;

// Relative to the card width.
const SCALES = { s: 0.82, m: 1, l: 1.24 } satisfies Record<SizeKey, number>;

const DIMENSIONS = {
  "1:1": [1080, 1080],
  "4:5": [1080, 1350],
  "9:16": [1080, 1920],
  "3:4": [1080, 1440],
} satisfies Record<Ratio, [number, number]>;

const FILENAME = "omnibus-quote.png";

const fontSpec = (
  px: number,
  family: string,
  weight: number,
  italic: boolean,
) => `${italic ? "italic " : ""}${weight} ${px}px ${family}`;

// A webfont the document hasn't loaded falls back mid-draw, and measureText would wrap
// against the wrong metrics, so every face is resolved first. A failure still exports.
async function loadFaces(card: CardDrawing) {
  const face = FACES[card.font];
  const [w] = DIMENSIONS[card.ratio];
  const body = fontSpec(
    Math.round(w * 0.052 * SCALES[card.size]),
    face.primary,
    card.bold ? 700 : 400,
    card.italic,
  );
  const sub = fontSpec(Math.round(w * 0.026), face.primary, 400, true);
  await Promise.all([
    document.fonts.load(body),
    document.fonts.load(sub),
  ]).catch(() => {});
}

function wrap(
  ctx: CanvasRenderingContext2D,
  quote: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of quote.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Draws the card on an offscreen canvas, or returns `null` when there is no 2D context. */
export async function drawQuoteCanvas(
  card: CardDrawing,
): Promise<HTMLCanvasElement | null> {
  await loadFaces(card);
  const [W, H] = DIMENSIONS[card.ratio];
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const pad = Math.round(W * 0.1);
  ctx.fillStyle = card.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = card.ink;
  ctx.textBaseline = "top";

  ctx.font = `600 ${Math.round(W * 0.018)}px ui-monospace, monospace`;
  ctx.globalAlpha = 0.55;
  ctx.fillText("OMNIBUS · QUOTE", pad, pad);
  ctx.globalAlpha = 1;

  const face = FACES[card.font];
  const fontPx = Math.round(W * 0.052 * SCALES[card.size]);
  ctx.font = fontSpec(fontPx, face.stack, card.bold ? 700 : 400, card.italic);
  const lines = wrap(ctx, `“${card.text}”`, W - pad * 2);
  const lineH = Math.round(fontPx * 1.3);
  const startY = Math.max(pad * 2.2, (H - lines.length * lineH) / 2 - lineH);
  lines.forEach((line, i) => {
    ctx.fillText(line, pad, startY + i * lineH);
  });

  const footY = H - pad - Math.round(W * 0.06);
  ctx.globalAlpha = 0.85;
  ctx.fillRect(pad, footY - Math.round(W * 0.02), W - pad * 2, 2);
  ctx.font = `${Math.round(W * 0.022)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.fillText(card.author.toUpperCase(), pad, footY);
  ctx.font = fontSpec(Math.round(W * 0.026), face.stack, 400, true);
  ctx.fillText(card.subtitle, pad, footY + Math.round(W * 0.035));
  ctx.globalAlpha = 1;
  return canvas;
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
