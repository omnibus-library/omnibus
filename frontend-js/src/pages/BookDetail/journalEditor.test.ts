import { describe, expect, it } from "vitest";
import { applyEdit, highlightBlockquote, renderLines } from "./journalEditor";

const textOf = (html: string) => {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.textContent;
};

describe("renderLines", () => {
  it.each([
    ["plain text", "just words"],
    [
      "inline marks",
      "**bold** and *em* and ~~gone~~ and ||spoiler|| and `code`",
    ],
    ["a link", "see [the map](https://example.com/a?b=1)"],
    ["headings and a quote", "# One\n## Two\n> quoted *text*"],
    ["lists and tasks", "- a\n1. b\n- [x] done\n- [ ] todo"],
    ["blank lines", "first\n\n\nlast\n"],
    ["markup characters", 'a < b && "c" > d'],
    ["an empty entry", ""],
  ])("keeps the text of %s exactly", (_case, md) => {
    expect(textOf(renderLines(md))).toBe(md);
  });

  it("wraps each line in a cm-line span", () => {
    const host = document.createElement("div");
    host.innerHTML = renderLines("# a\nb");
    expect(host.querySelectorAll(":scope > .cm-line")).toHaveLength(2);
    expect(host.querySelector(".cm-h1 .cm-mark")?.textContent).toBe("# ");
  });

  it("escapes markup instead of rendering it", () => {
    const host = document.createElement("div");
    host.innerHTML = renderLines("<img src=x onerror=alert(1)>");
    expect(host.querySelector("img")).toBeNull();
  });
});

describe("applyEdit", () => {
  const md = "one two\nthree";

  it("wraps the selection and keeps it selected", () => {
    expect(
      applyEdit(
        md,
        { start: 4, end: 7 },
        { op: "wrap", before: "**", after: "**" },
      ),
    ).toEqual({ md: "one **two**\nthree", start: 6, end: 9 });
  });

  it("wraps an empty selection with the caret between the marks", () => {
    expect(
      applyEdit(
        "ab",
        { start: 1, end: 1 },
        { op: "wrap", before: "*", after: "*" },
      ),
    ).toEqual({ md: "a**b", start: 2, end: 2 });
  });

  it("prefixes every line the selection touches", () => {
    expect(
      applyEdit(md, { start: 5, end: 10 }, { op: "prefix", prefix: "> " }),
    ).toEqual({ md: "> one two\n> three", start: 0, end: 14 });
  });

  it("prefixes the first line when the entry opens on a blank one", () => {
    expect(
      applyEdit("\nabc", { start: 0, end: 0 }, { op: "prefix", prefix: "# " }),
    ).toEqual({ md: "# \nabc", start: 0, end: 2 });
  });

  it("links the selection and selects the url", () => {
    expect(
      applyEdit(
        md,
        { start: 4, end: 7 },
        { op: "link", text: "text", url: "https://" },
      ),
    ).toEqual({ md: "one [two](https://)\nthree", start: 10, end: 18 });
  });

  it("links the placeholder text when nothing is selected", () => {
    expect(
      applyEdit(
        "",
        { start: 0, end: 0 },
        { op: "link", text: "text", url: "https://" },
      ),
    ).toEqual({ md: "[text](https://)", start: 7, end: 15 });
  });

  it("inserts over the selection and puts the caret after it", () => {
    expect(
      applyEdit(md, { start: 0, end: 3 }, { op: "insert", text: "ONE\n" }),
    ).toEqual({ md: "ONE\n two\nthree", start: 4, end: 4 });
  });
});

describe("highlightBlockquote", () => {
  it("quotes every line and credits the highlights", () => {
    expect(highlightBlockquote("a\nb")).toBe(
      "\n> a\n> b\n>\n> — saved from highlights\n",
    );
  });
});
