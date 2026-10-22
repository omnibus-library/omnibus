import { afterEach, describe, expect, it, vi } from "vitest";
import { deferred } from "./testing/handlers";
import { turnMode, turnPage } from "./viewTransition";

// jsdom has neither matchMedia nor View Transitions, so a test says what the browser offers.
const stubReducedMotion = (reduce: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce,
    media: query,
  }));

type StartViewTransition = (update: () => void) => {
  updateCallbackDone: Promise<void>;
};

const stubViewTransitions = (start: StartViewTransition) =>
  Object.assign(document, { startViewTransition: start });

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "startViewTransition");
});

describe("turnMode", () => {
  it("reports css without view transitions", () => {
    stubReducedMotion(false);

    expect(turnMode()).toBe("css");
  });

  it("reports view-transition when the browser has them", () => {
    stubReducedMotion(false);
    stubViewTransitions(() => ({ updateCallbackDone: Promise.resolve() }));

    expect(turnMode()).toBe("view-transition");
  });

  it("reports instant under reduced motion", () => {
    stubReducedMotion(true);
    stubViewTransitions(() => ({ updateCallbackDone: Promise.resolve() }));

    expect(turnMode()).toBe("instant");
  });
});

describe("turnPage", () => {
  it("runs the update at once under reduced motion", async () => {
    stubReducedMotion(true);
    const start = vi.fn<StartViewTransition>();
    stubViewTransitions(start);
    const update = vi.fn();

    const done = turnPage(update);

    expect(update).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
    await done;
  });

  it("runs the update at once without view transitions", async () => {
    stubReducedMotion(false);
    const update = vi.fn();

    const done = turnPage(update);

    expect(update).toHaveBeenCalledOnce();
    await done;
  });

  it("runs the update inside startViewTransition", async () => {
    stubReducedMotion(false);
    const order: string[] = [];
    stubViewTransitions((update) => {
      order.push("start");
      update();
      return { updateCallbackDone: Promise.resolve() };
    });

    await turnPage(() => order.push("update"));

    expect(order).toEqual(["start", "update"]);
  });

  it("resolves after the update callback is done", async () => {
    stubReducedMotion(false);
    const callbackDone = deferred();
    stubViewTransitions(() => ({ updateCallbackDone: callbackDone.promise }));
    let resolved = false;

    const done = turnPage(() => {}).then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    callbackDone.release();
    await done;
    expect(resolved).toBe(true);
  });
});
