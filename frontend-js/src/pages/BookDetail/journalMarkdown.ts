export type Selection = { start: number; end: number };

export type EditOp =
  | { op: "wrap"; before: string; after: string }
  | { op: "prefix"; prefix: string }
  | { op: "link"; text: string; url: string }
  | { op: "insert"; text: string };

export type Edit = Selection & { md: string };

/** Applies a toolbar edit to the markdown and says where the selection lands. */
export function applyEdit(
  md: string,
  { start, end }: Selection,
  edit: EditOp,
): Edit {
  const selected = md.slice(start, end);
  switch (edit.op) {
    case "wrap": {
      const from = start + edit.before.length;
      return {
        md:
          md.slice(0, start) +
          edit.before +
          selected +
          edit.after +
          md.slice(end),
        start: from,
        end: from + selected.length,
      };
    }
    case "prefix": {
      const lineStart = md.slice(0, start).lastIndexOf("\n") + 1;
      const prefixed = md
        .slice(lineStart, end)
        .split("\n")
        .map((line) => edit.prefix + line)
        .join("\n");
      return {
        md: md.slice(0, lineStart) + prefixed + md.slice(end),
        start: lineStart,
        end: lineStart + prefixed.length,
      };
    }
    case "link": {
      const text = selected || edit.text;
      const urlStart = start + text.length + 3;
      return {
        md: `${md.slice(0, start)}[${text}](${edit.url})${md.slice(end)}`,
        start: urlStart,
        end: urlStart + edit.url.length,
      };
    }
    case "insert": {
      const at = start + edit.text.length;
      return {
        md: md.slice(0, start) + edit.text + md.slice(end),
        start: at,
        end: at,
      };
    }
    default: {
      const _exhaustive: never = edit;
      return _exhaustive;
    }
  }
}

/** A saved passage as a markdown blockquote with an attribution line. */
export const highlightBlockquote = (text: string) =>
  `\n${text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}\n>\n> — saved from highlights\n`;

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const mark = (s: string) => `<span class="cm-mark">${escapeHtml(s)}</span>`;

// Longest first so `**` wins over `*`; code last so its body is escaped, not re-tokenised.
const PAIRS = [
  ["**", "cm-strong"],
  ["~~", "cm-strike"],
  ["||", "cm-spoiler"],
  ["*", "cm-em"],
  ["_", "cm-em"],
  ["`", "cm-code"],
] as const;

function inline(line: string): string {
  let out = "";
  let i = 0;
  scan: while (i < line.length) {
    const link =
      line[i] === "[" && /^\[([^\]\n]+)\]\(([^)\n]+)\)/.exec(line.slice(i));
    if (link) {
      out += `<span class="cm-link">${mark("[")}${escapeHtml(link[1] ?? "")}${mark(`](${link[2]})`)}</span>`;
      i += link[0].length;
      continue;
    }
    for (const [token, cls] of PAIRS) {
      if (!line.startsWith(token, i)) continue;
      const close = line.indexOf(token, i + token.length);
      if (close <= i + token.length - 1) continue;
      const inner = line.slice(i + token.length, close);
      if (!inner.length) continue;
      const body = cls === "cm-code" ? escapeHtml(inner) : inline(inner);
      out += `<span class="${cls}">${mark(token)}${body}${mark(token)}</span>`;
      i = close + token.length;
      continue scan;
    }
    out += escapeHtml(line.charAt(i));
    i++;
  }
  return out;
}

function blockLine(line: string): string {
  const heading = /^(#{1,2})\s/.exec(line);
  if (heading) {
    const cls = heading[1]?.length === 1 ? "cm-h1" : "cm-h2";
    return `<span class="${cls}">${mark(heading[0])}${inline(line.slice(heading[0].length))}</span>`;
  }
  const quote = /^>\s/.exec(line);
  if (quote) {
    return `<span class="cm-quote">${mark(quote[0])}${inline(line.slice(quote[0].length))}</span>`;
  }
  // A faded marker leaves no glyph, so the wrapper carries one in `data-bullet`, never as text.
  const task = /^- \[([ xX])\]\s/.exec(line);
  if (task) {
    const bullet = task[1] === " " ? "☐" : "☑";
    return `<span class="cm-task" data-bullet="${bullet}">${mark(task[0])}${inline(line.slice(task[0].length))}</span>`;
  }
  const list = /^(\s*)([-*]|\d+\.)\s/.exec(line);
  if (list) {
    const marker = list[2] ?? "";
    const bullet = /^\d/.test(marker) ? marker : "•";
    return `${escapeHtml(list[1] ?? "")}<span class="cm-list" data-bullet="${escapeHtml(bullet)}">${mark(`${marker} `)}</span>${inline(line.slice(list[0].length))}`;
  }
  return inline(line);
}

/**
 * The markdown as one `.cm-line` span per line, decorated, with the newlines kept as text so
 * `textContent` is the markdown exactly.
 */
export function renderLines(md: string): string {
  const lines = md.split("\n");
  return lines
    .map((line, i) => {
      // A `<br>` gives an empty last line a height and a caret; an interior one would double it.
      const filler = i === lines.length - 1 ? "<br>" : "";
      return `<span class="cm-line">${blockLine(line) || filler}</span>`;
    })
    .join("\n");
}
