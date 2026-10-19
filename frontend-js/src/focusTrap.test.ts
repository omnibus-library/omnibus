import { beforeEach, describe, expect, it, vi } from "vitest";
import { trapTab } from "./focusTrap";

let dialog: HTMLElement;
let first: HTMLElement;
let last: HTMLElement;

beforeEach(() => {
  document.body.innerHTML =
    '<div id="d" tabindex="-1"><button id="a">A</button><input id="m"><button id="z">Z</button><button disabled>off</button></div>';
  dialog = document.getElementById("d") as HTMLElement;
  first = document.getElementById("a") as HTMLElement;
  last = document.getElementById("z") as HTMLElement;
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
});
