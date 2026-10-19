import { useMutation } from "@tanstack/react-query";
import {
  type ClipboardEvent,
  type KeyboardEvent,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { uploadJournalImage } from "../../api";
import { Button } from "../../components/Button/Button";
import { Ring } from "../../components/Loading/Loading";
import {
  applyEdit,
  type EditOp,
  renderLines,
  type Selection,
} from "./journalMarkdown";

// The surface is a `contenteditable` whose text is the markdown, character for character: the
// decorations are spans around it, so a caret is an absolute offset into `textContent`.

const lineSpans = (editor: HTMLElement) =>
  editor.querySelectorAll(":scope > .cm-line");

function offsetAt(root: Node, node: Node | null, offset: number) {
  if (!node || !root.contains(node)) return null;
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(node, offset);
  return before.toString().length;
}

function caret(root: HTMLElement): Selection | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const start = offsetAt(root, range.startContainer, range.startOffset);
  return start === null
    ? null
    : { start, end: start + range.toString().length };
}

// A boundary offset lands inside its line, not at the end of the previous inline span; an
// empty line has no text node, so its span at 0 puts the caret before the placeholder `<br>`.
function locate(root: HTMLElement, offset: number) {
  let passed = 0;
  const lines = [...lineSpans(root)];
  for (const line of lines) {
    const length = line.textContent?.length ?? 0;
    if (offset <= passed + length) {
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let seen = 0;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const size = n.nodeValue?.length ?? 0;
        if (offset - passed <= seen + size) {
          return { node: n, offset: offset - passed - seen };
        }
        seen += size;
      }
      return { node: line, offset: 0 };
    }
    passed += length + 1;
  }
  const last = lines.at(-1);
  if (!last) return { node: root, offset: 0 };
  const walker = document.createTreeWalker(last, NodeFilter.SHOW_TEXT);
  let tail: Node | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) tail = n;
  return tail
    ? { node: tail, offset: tail.nodeValue?.length ?? 0 }
    : { node: last, offset: 0 };
}

// Keeps which end is the anchor: a Range is document-ordered and would flip a leftward drag.
function select(root: HTMLElement, anchor: number, focus: number) {
  const from = locate(root, anchor);
  const to = locate(root, focus);
  window
    .getSelection()
    ?.setBaseAndExtent(from.node, from.offset, to.node, to.offset);
}

// Markers are faded by CSS except on the line the caret is on.
function markActive(editor: HTMLElement) {
  const at = caret(editor);
  const active = at
    ? (editor.textContent ?? "").slice(0, at.start).split("\n").length - 1
    : -1;
  lineSpans(editor).forEach((line, i) => {
    line.classList.toggle("cm-active", i === active);
  });
}

function jumpTo(editor: HTMLElement, key: "Home" | "End", extend: boolean) {
  const target = key === "End" ? (editor.textContent ?? "").length : 0;
  const sel = window.getSelection();
  // The anchor comes off the Selection: `caret` is document-ordered, not the edge being dragged.
  const anchor = extend
    ? offsetAt(editor, sel?.anchorNode ?? null, sel?.anchorOffset ?? 0)
    : target;
  select(editor, anchor ?? target, target);
  markActive(editor);
  const lines = [...lineSpans(editor)];
  (key === "End" ? lines.at(-1) : lines[0])?.scrollIntoView({
    block: "nearest",
  });
}

export type EditorHandle = { apply: (edit: EditOp) => void };

type JournalEditorProps = {
  /** The markdown the editor opens with; later changes are ignored, the editor owns its text. */
  initial: string;
  onChange: (md: string) => void;
  label: string;
  testId: string;
  placeholder?: string;
  ref: Ref<EditorHandle>;
};

/** A live markdown editor: syntax marks fade out except on the caret's line. */
export function JournalEditor({
  initial,
  onChange,
  label,
  testId,
  placeholder,
  ref,
}: JournalEditorProps) {
  const [seed] = useState(() => renderLines(initial));
  const surface = useRef<HTMLDivElement>(null);
  const composing = useRef(false);

  const paint = (md: string, at: Selection | null) => {
    const editor = surface.current;
    if (!editor) return;
    editor.innerHTML = renderLines(md);
    if (at) select(editor, at.start, at.end);
    markActive(editor);
  };

  const edit = (op: EditOp) => {
    const editor = surface.current;
    if (!editor) return;
    const md = editor.textContent ?? "";
    const next = applyEdit(
      md,
      caret(editor) ?? { start: md.length, end: md.length },
      op,
    );
    paint(next.md, next);
    onChange(next.md);
    editor.focus();
  };

  useImperativeHandle(ref, () => ({ apply: edit }));

  useEffect(() => {
    const editor = surface.current;
    if (!editor) return;
    const follow = () => markActive(editor);
    document.addEventListener("selectionchange", follow);
    return () => document.removeEventListener("selectionchange", follow);
  }, []);

  const redraw = () => {
    const editor = surface.current;
    if (!editor || composing.current) return;
    const md = editor.textContent ?? "";
    paint(md, caret(editor));
    onChange(md);
  };

  // Enter, paste and the document-edge jumps go through the model: the browser's own would
  // add `<br>`/`<div>` nodes, or resolve against the decoration spans and land mid-document.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      edit({ op: "insert", text: "\n" });
    } else if (
      (event.key === "Home" || event.key === "End") &&
      (event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault();
      jumpTo(event.currentTarget, event.key, event.shiftKey);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    edit({ op: "insert", text: event.clipboardData.getData("text/plain") });
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a textarea can't hold the decoration spans
    <div
      ref={surface}
      className="me-textarea bd-journal-editor"
      data-testid={testId}
      contentEditable
      suppressContentEditableWarning
      tabIndex={0}
      role="textbox"
      aria-multiline="true"
      aria-label={label}
      data-placeholder={placeholder}
      onInput={redraw}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        redraw();
      }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: renderLines escapes every character of the markdown
      dangerouslySetInnerHTML={{ __html: seed }}
    />
  );
}

const TOOLS: { label: string; title: string; edit: EditOp }[] = [
  {
    label: "B",
    title: "Bold",
    edit: { op: "wrap", before: "**", after: "**" },
  },
  {
    label: "I",
    title: "Italic",
    edit: { op: "wrap", before: "*", after: "*" },
  },
  {
    label: "S",
    title: "Strikethrough",
    edit: { op: "wrap", before: "~~", after: "~~" },
  },
  { label: "H1", title: "Heading 1", edit: { op: "prefix", prefix: "# " } },
  { label: "H2", title: "Heading 2", edit: { op: "prefix", prefix: "## " } },
  { label: "“", title: "Quote", edit: { op: "prefix", prefix: "> " } },
  { label: "•", title: "Bullet list", edit: { op: "prefix", prefix: "- " } },
  {
    label: "1.",
    title: "Numbered list",
    edit: { op: "prefix", prefix: "1. " },
  },
  {
    label: "[ ]",
    title: "Checklist",
    edit: { op: "prefix", prefix: "- [ ] " },
  },
  {
    label: "{ }",
    title: "Inline code",
    edit: { op: "wrap", before: "`", after: "`" },
  },
  {
    label: "🔗",
    title: "Link",
    edit: { op: "link", text: "text", url: "https://" },
  },
  {
    label: "Spoiler",
    title: "Spoiler — blurred until clicked",
    edit: { op: "wrap", before: "||", after: "||" },
  },
];

const CAPTION = "Add a caption";

type JournalToolbarProps = {
  editor: { current: EditorHandle | null };
  onError: (message: string | null) => void;
};

/** Formatting buttons plus an image upload, acting on `editor`'s selection. */
export function JournalToolbar({ editor, onError }: JournalToolbarProps) {
  const picker = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: uploadJournalImage,
    onSuccess: (url) => {
      editor.current?.apply({
        op: "insert",
        text: `\n\n![${CAPTION}](${url})\n`,
      });
    },
    onError: (error) => onError(error.message),
  });
  // A mousedown would move focus out of the editor and collapse the selection being formatted.
  const keepFocus = (event: { preventDefault: () => void }) =>
    event.preventDefault();
  return (
    <div
      className="bd-journal-toolbar"
      data-testid="journal-toolbar"
      role="toolbar"
    >
      {TOOLS.map(({ label, title, edit }) => (
        <Button
          key={title}
          variant="ghost"
          size="sm"
          className="bd-journal-tool"
          title={title}
          aria-label={title}
          onMouseDown={keepFocus}
          onClick={() => editor.current?.apply(edit)}
        >
          {label}
        </Button>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="bd-journal-tool bd-journal-image-tool"
        title="Insert image"
        aria-label="Insert image"
        aria-busy={upload.isPending}
        disabled={upload.isPending}
        onMouseDown={keepFocus}
        onClick={() => picker.current?.click()}
      >
        <span className="bd-journal-image-glyph">
          {upload.isPending ? <Ring size="xs" /> : "🖼"}
        </span>
      </Button>
      <input
        ref={picker}
        type="file"
        className="bd-journal-image-input"
        accept="image/jpeg,image/png,image/webp,image/gif"
        data-testid="journal-image-input"
        aria-label="Image file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          onError(null);
          upload.mutate(file);
        }}
      />
    </div>
  );
}
