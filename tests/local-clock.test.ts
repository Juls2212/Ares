import { describe, expect, it } from "vitest";
import { formatLocalClock } from "../src/renderer/local-clock";

describe("local Ares clock", () => {
  it("formats a local 24-hour clock without external data", () => {
    expect(formatLocalClock(new Date(2026, 8, 28, 9, 5))).toMatch(/^09:05$/);
  });
});
