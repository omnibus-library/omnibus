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
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
  finished: Promise<void>;
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
    stubViewTransitions(() => ({
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      finished: Promise.resolve(),
    }));

    expect(turnMode()).toBe("view-transition");
  });

  it("reports instant under reduced motion", () => {
    stubReducedMotion(true);
    stubViewTransitions(() => ({
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      finished: Promise.resolve(),
    }));

    expect(turnMode()).toBe("instant");
  });
});

describe("turnPage", () => {
  it("runs the update at once under reduced motion", async () => {
    stubReducedMotion(true);
    const start = vi.fn<StartViewTransition>();
    stubViewTransitions(start);
    const update = vi.fn();

    const done = turnPage(update).updated;

    expect(update).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
    await done;
  });

  it("runs the update at once without view transitions", async () => {
    stubReducedMotion(false);
    const update = vi.fn();

    const done = turnPage(update).updated;

    expect(update).toHaveBeenCalledOnce();
    await done;
  });

  it("runs the update inside startViewTransition", async () => {
    stubReducedMotion(false);
    const order: string[] = [];
    stubViewTransitions((update) => {
      order.push("start");
      update();
      return {
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        finished: Promise.resolve(),
      };
    });

    await turnPage(() => order.push("update")).updated;

    expect(order).toEqual(["start", "update"]);
  });

  it("resolves after the update callback is done", async () => {
    stubReducedMotion(false);
    const callbackDone = deferred();
    stubViewTransitions(() => ({
      ready: Promise.resolve(),
      updateCallbackDone: callbackDone.promise,
      finished: Promise.resolve(),
    }));
    let resolved = false;

    const done = turnPage(() => {}).updated.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    callbackDone.release();
    await done;
    expect(resolved).toBe(true);
  });
});

describe("turnPage finished", () => {
  it("settles finished only once the turn is drawn, after updated", async () => {
    stubReducedMotion(false);
    const drawn = deferred();
    stubViewTransitions((update) => {
      update();
      return {
        ready: Promise.resolve(),
        updateCallbackDone: Promise.resolve(),
        finished: drawn.promise,
      };
    });
    let finished = false;

    const turn = turnPage(() => {});
    turn.finished.then(() => {
      finished = true;
    });
    await turn.updated;
    await Promise.resolve();
    expect(finished).toBe(false);

    drawn.release();
    await turn.finished;
    expect(finished).toBe(true);
  });

  it("settles finished for a turn the next one skipped", async () => {
    stubReducedMotion(false);
    stubViewTransitions(() => ({
      ready: Promise.reject(new Error("skipped")),
      updateCallbackDone: Promise.resolve(),
      finished: Promise.reject(new Error("skipped")),
    }));

    await expect(turnPage(() => {}).finished).resolves.toBeUndefined();
  });

  it("is finished at once without view transitions", async () => {
    stubReducedMotion(true);
    const update = vi.fn();

    await turnPage(update).finished;

    expect(update).toHaveBeenCalledOnce();
  });
});
