import { beforeEach, describe, expect, it, vi } from "vitest";
import { trapTab } from "./focusTrap";

let dialog: HTMLElement;
let first: HTMLElement;
let last: HTMLElement;

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!(found instanceof HTMLElement)) throw new Error(`no element #${id}`);
  return found;
}

beforeEach(() => {
  document.body.innerHTML =
    '<div id="d" tabindex="-1"><button id="a">A</button><input id="m"><button id="z">Z</button><button disabled>off</button></div>';
  dialog = element("d");
  first = element("a");
  last = element("z");
});

const press = (key: string, shiftKey: boolean) => ({
  key,
  shiftKey,
  preventDefault: vi.fn(),
});

describe("trapTab", () => {
  it("wraps Tab from the last tabbable element to the first", () => {
    last.focus();
    const event = press("Tab", false);

    trapTab(event, dialog);

    expect(document.activeElement).toBe(first);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("wraps Shift+Tab from the first element, or the dialog itself, to the last", () => {
    for (const start of [first, dialog]) {
      start.focus();
      const event = press("Tab", true);

      trapTab(event, dialog);

      expect(document.activeElement).toBe(last);
      expect(event.preventDefault).toHaveBeenCalled();
    }
  });

  it("leaves Tab alone between the ends and any other key alone", () => {
    const tab = press("Tab", false);
    const other = press("Enter", false);

    document.getElementById("m")?.focus();
    trapTab(tab, dialog);
    last.focus();
    trapTab(other, dialog);

    expect(tab.preventDefault).not.toHaveBeenCalled();
    expect(other.preventDefault).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(last);
  });

  it("holds focus on the dialog when nothing inside it can be tabbed to", () => {
    document.body.innerHTML =
      '<div id="d" tabindex="-1"><button id="a" disabled>A</button></div>';
    const empty = element("d");
    for (const shiftKey of [false, true]) {
      empty.blur();
      const event = press("Tab", shiftKey);

      trapTab(event, empty);

      expect(document.activeElement).toBe(empty);
      expect(event.preventDefault).toHaveBeenCalled();
    }
  });
});
