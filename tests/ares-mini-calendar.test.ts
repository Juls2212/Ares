import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AresMiniCalendar,
  createMiniCalendarGrid,
  formatMiniCalendarMonth,
  MINI_CALENDAR_WEEKDAYS,
  millisecondsUntilNextLocalDay
} from "../src/renderer/features/assistant/ares-mini-calendar";

describe("Ares local mini calendar", () => {
  it("creates a Monday-first local grid with the actual current day highlighted", () => {
    const grid = createMiniCalendarGrid(new Date(2026, 9, 2));

    expect(grid).toHaveLength(35);
    expect(grid.slice(0, 3)).toEqual([undefined, undefined, undefined]);
    expect(grid[3]).toMatchObject({ day: 1, isToday: false });
    expect(grid[4]).toMatchObject({ day: 2, isToday: true });
    expect(grid[33]).toMatchObject({ day: 31, isToday: false });
    expect(grid.at(-1)).toBeUndefined();
  });

  it("uses Spanish local month text, weekday initials, and an accessible today marker", () => {
    expect(formatMiniCalendarMonth(new Date(2026, 9, 2))).toBe("octubre de 2026");
    expect(MINI_CALENDAR_WEEKDAYS).toEqual(["L", "M", "X", "J", "V", "S", "D"]);
    const markup = renderToStaticMarkup(createElement(AresMiniCalendar));

    expect(markup).toContain("Calendario de ");
    expect(markup).toContain('aria-current="date"');
  });

  it("schedules the next local refresh at the next day boundary rather than on a frequent interval", () => {
    const now = new Date(2026, 9, 2, 23, 59, 30);

    expect(millisecondsUntilNextLocalDay(now)).toBe(30_000);
  });
});
