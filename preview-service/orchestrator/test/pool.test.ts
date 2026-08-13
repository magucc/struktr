import { describe, expect, it } from "vitest";
import { isPoolOpen } from "../src/pool.js";

const AMS = { hours: "08:00-18:30", days: "1-5", tz: "Europe/Amsterdam" };

// 2026-08-12 is a Wednesday. 12:00 UTC = 14:00 CEST.
const wedNoonUtc = new Date("2026-08-12T12:00:00Z");
const wedNightUtc = new Date("2026-08-12T20:00:00Z"); // 22:00 CEST
const sunNoonUtc = new Date("2026-08-16T12:00:00Z");

describe("isPoolOpen", () => {
  it("open during business hours on a weekday", () => {
    expect(isPoolOpen(AMS, wedNoonUtc)).toBe(true);
  });

  it("closed in the evening", () => {
    expect(isPoolOpen(AMS, wedNightUtc)).toBe(false);
  });

  it("closed on Sunday", () => {
    expect(isPoolOpen(AMS, sunNoonUtc)).toBe(false);
  });

  it("respects timezone (same instant, Tokyo pool is closed)", () => {
    expect(isPoolOpen({ ...AMS, tz: "Asia/Tokyo" }, wedNoonUtc)).toBe(false); // 21:00 JST
  });

  it("boundary: closes exactly at end time", () => {
    // 16:30 UTC = 18:30 CEST — pool just closed
    expect(isPoolOpen(AMS, new Date("2026-08-12T16:30:00Z"))).toBe(false);
    expect(isPoolOpen(AMS, new Date("2026-08-12T16:29:00Z"))).toBe(true);
  });

  it("rejects malformed hours", () => {
    expect(() => isPoolOpen({ ...AMS, hours: "9-17" }, wedNoonUtc)).toThrow(/POOL_HOURS/);
  });
});
