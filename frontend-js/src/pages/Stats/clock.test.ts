import { describe, expect, it } from "vitest";
import {
  buildTicks,
  buildWeekdays,
  clockLine,
  dayReadout,
  hourLabel,
  peakHour,
  TICK_MIN_PX,
  TICK_REACH_PX,
  tickTransform,
  unzonedNote,
} from "./clock";

function hours(values: number[]) {
  return values.map((seconds, hour) => ({ hour, seconds }));
}

const quietDay = () => new Array<number>(24).fill(0);

function weekdays(values: number[]) {
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return values.map((seconds, weekday) => ({
    weekday,
    label: labels[weekday] ?? "",
    seconds,
  }));
}

describe("tickTransform", () => {
  // The tick grows outward (downward) from the centre, so hour 0 needs the half-turn to point up.
  it("puts midnight at the top and walks clockwise", () => {
    expect(tickTransform(0)).toBe("rotate(180deg) translateY(58px)");
    expect(tickTransform(6)).toBe("rotate(270deg) translateY(58px)");
    expect(tickTransform(12)).toBe("rotate(360deg) translateY(58px)");
    expect(tickTransform(18)).toBe("rotate(450deg) translateY(58px)");
  });
});

describe("buildTicks", () => {
  it("scales to the busiest hour and keeps a floor", () => {
    const values = quietDay();
    values[20] = 1_000;
    values[8] = 500;
    values[3] = 10;
    const ticks = buildTicks(hours(values));

    expect(ticks).toHaveLength(24);
    expect(ticks[20]?.heightPx).toBe(TICK_REACH_PX);
    expect(ticks[8]?.heightPx).toBe(TICK_REACH_PX / 2);
    // A quiet hour still leaves a mark: an invisible tick would read as a missing hour.
    expect(ticks[3]?.heightPx).toBe(TICK_MIN_PX);
    expect(ticks[0]?.heightPx).toBe(TICK_MIN_PX);
  });

  it("weights the rim so it reads as a shape", () => {
    const values = quietDay();
    values[20] = 100;
    values[19] = 50;
    values[8] = 20;
    values[3] = 1;
    const ticks = buildTicks(hours(values));

    expect([20, 19, 8, 3, 0].map((h) => ticks[h]?.weight)).toEqual([
      "hot",
      "warm",
      "cool",
      "idle",
      "idle",
    ]);
  });

  it("draws 24 floor ticks for a window with nothing in it", () => {
    const ticks = buildTicks(hours(quietDay()));

    expect(
      ticks.every((t) => t.heightPx === TICK_MIN_PX && t.weight === "idle"),
    ).toBe(true);
  });
});

describe("hourLabel", () => {
  it("reads as a clock, not as an index", () => {
    expect(hourLabel(0)).toBe("12am");
    expect(hourLabel(1)).toBe("1am");
    expect(hourLabel(11)).toBe("11am");
    expect(hourLabel(12)).toBe("12pm");
    expect(hourLabel(20)).toBe("8pm");
    expect(hourLabel(23)).toBe("11pm");
  });
});

describe("peakHour", () => {
  it("names the busiest hour", () => {
    const values = quietDay();
    values[20] = 900;

    expect(peakHour(hours(values))).toBe("8pm");
  });

  // The first maximum of a row of zeros would claim a reader with no activity reads at midnight.
  it("never claims midnight on an empty window", () => {
    expect(peakHour(hours(quietDay()))).toBe("—");
    expect(peakHour([])).toBe("—");
  });

  it("gives a tie to the later hour", () => {
    const values = quietDay();
    values[7] = 600;
    values[20] = 600;

    expect(peakHour(hours(values))).toBe("8pm");
  });
});

describe("clockLine", () => {
  it("names the part of the day the window belongs to", () => {
    const evening = quietDay();
    evening[19] = 300;
    evening[20] = 400;
    evening[21] = 300;

    expect(clockLine(hours(evening))).toBe(
      "Evenings are yours — 100% of your recorded time lands between 5pm and 10pm.",
    );
  });

  it("counts 11pm and 2am together in the late band that wraps past midnight", () => {
    const late = quietDay();
    late[23] = 600;
    late[2] = 400;

    expect(clockLine(hours(late))).toMatch(/^You read late/);
  });

  it("gives a tie to the later band", () => {
    const split = quietDay();
    split[8] = 500;
    split[13] = 500;

    expect(clockLine(hours(split))).toMatch(/^Afternoons are yours — 50%/);
  });

  it("is absent when nothing can be placed on a clock", () => {
    expect(clockLine(hours(quietDay()))).toBeNull();
    expect(clockLine([])).toBeNull();
  });
});

describe("dayReadout", () => {
  it("never reports a quiet day as a measured zero", () => {
    expect(dayReadout(0)).toBe("—");
    expect(dayReadout(58 * 60)).toBe("58m");
    expect(dayReadout(3_600)).toBe("1h");
    expect(dayReadout(3_600 + 28 * 60)).toBe("1h 28m");
  });
});

describe("buildWeekdays", () => {
  it("scales to the busiest day and flags the quiet ones", () => {
    const rows = buildWeekdays(weekdays([600, 0, 300, 0, 0, 0, 1_200]));

    expect(rows).toHaveLength(7);
    expect(rows[6]).toMatchObject({ widthPct: 100, weight: "hot" });
    expect(rows[0]).toMatchObject({ widthPct: 50, weight: "warm" });
    expect(rows[1]).toMatchObject({
      widthPct: 0,
      weight: "idle",
      readout: "—",
    });
  });

  it("keeps the server's labels and order", () => {
    expect(
      buildWeekdays(weekdays([1, 1, 1, 1, 1, 1, 1])).map((r) => r.label),
    ).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });
});

describe("unzonedNote", () => {
  it("discloses only what it could not place", () => {
    expect(unzonedNote(0)).toBeNull();
    expect(unzonedNote(7 * 60)).toMatch(/^7m of activity/);
  });
});
