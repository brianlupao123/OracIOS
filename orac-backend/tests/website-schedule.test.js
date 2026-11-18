import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SCHEDULE, normalizeSchedule, parseDate, weekday, slotTimes, checkSlot, availability, localNow } from "../src/modules/public/booking/schedule.js";

const S = { ...DEFAULT_SCHEDULE, enabled: true }; // Mon-Fri 08:00-16:00, 60 min, capacity 1, lead 24h, 30 days
// 2026-10-07 is a Wednesday. 06:00 UTC = 08:00 in Zimbabwe (UTC+2).
const WED_8AM = Date.UTC(2026, 9, 7, 6, 0);

test("weekday and date parsing do not depend on the server time zone", () => {
  assert.equal(weekday("2026-10-05"), 1); // Monday
  assert.equal(weekday("2026-10-10"), 6); // Saturday
  assert.equal(weekday("2026-10-11"), 0); // Sunday
  for (const bad of ["2026-02-31", "2026-13-01", "tomorrow", "", null, undefined, "2026-1-5"]) assert.equal(parseDate(bad), null, String(bad));
});

test("slot grid respects length and breaks, and drops slots that do not fit", () => {
  assert.deepEqual(slotTimes(S), ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00"]);
  assert.ok(!slotTimes({ ...S, breaks: [{ start: "12:00", end: "13:00" }] }).includes("12:00"));
  assert.deepEqual(slotTimes({ ...S, start: "08:00", end: "09:45" }), ["08:00"]);
});

test("rules: disabled, weekends, blocked dates, off-grid times, lead time", () => {
  assert.equal(checkSlot({ ...S, enabled: false }, "2026-10-09", "10:00", [], WED_8AM).ok, false);
  assert.equal(checkSlot(S, "2026-10-10", "10:00", [], WED_8AM).reason, "That is not a working day.");
  assert.equal(checkSlot({ ...S, blockedDates: ["2026-10-09"] }, "2026-10-09", "10:00", [], WED_8AM).reason, "That date is not available.");
  assert.equal(checkSlot(S, "2026-10-09", "08:30", [], WED_8AM).reason, "That is not an available time.");
  assert.equal(checkSlot(S, "2026-10-07", "15:00", [], WED_8AM).reason, "That time is too soon to book online.");
  assert.equal(checkSlot(S, "2026-10-08", "08:00", [], WED_8AM).ok, true); // exactly 24h ahead
  assert.equal(checkSlot(S, "2026-10-09", "10:00", [], WED_8AM).ok, true);
});

test("Zimbabwe midnight: 23:30 UTC is already tomorrow in Harare", () => {
  const now = Date.UTC(2026, 9, 7, 23, 30); // = Thu 2026-10-08 01:30 local
  assert.equal(localNow(S, now).date, "2026-10-08");
  const open = { ...S, leadHours: 0 };
  assert.equal(checkSlot(open, "2026-10-07", "15:00", [], now).ok, false); // yesterday locally
  assert.equal(checkSlot(open, "2026-10-08", "08:00", [], now).ok, true);
});

test("booking horizon", () => {
  const open = { ...S, leadHours: 0, horizonDays: 30 };
  assert.equal(checkSlot(open, "2026-11-06", "10:00", [], WED_8AM).ok, true); // today + 30 (a Friday)
  assert.equal(checkSlot(open, "2026-11-09", "10:00", [], WED_8AM).reason, "That date is too far ahead.");
});

test("capacity: requested/confirmed hold a slot, cancelled releases it", () => {
  const b = (slotStatus) => ({ slotDate: "2026-10-09", slotTime: "10:00", slotStatus });
  assert.equal(checkSlot(S, "2026-10-09", "10:00", [b("requested")], WED_8AM).reason, "That time has just been taken.");
  assert.equal(checkSlot(S, "2026-10-09", "10:00", [b("confirmed")], WED_8AM).ok, false);
  assert.equal(checkSlot(S, "2026-10-09", "10:00", [b("cancelled")], WED_8AM).ok, true);
  assert.equal(checkSlot({ ...S, capacity: 2 }, "2026-10-09", "10:00", [b("requested")], WED_8AM).ok, true);
  assert.equal(checkSlot({ ...S, capacity: 2 }, "2026-10-09", "10:00", [b("requested"), b("confirmed")], WED_8AM).ok, false);
});

test("availability lists only working days and marks taken slots", () => {
  const days = availability(S, "2026-10-07", 7, [{ slotDate: "2026-10-09", slotTime: "10:00", slotStatus: "requested" }], WED_8AM);
  assert.ok(days.every((d) => ![0, 6].includes(weekday(d.date))), "no weekends");
  const fri = days.find((d) => d.date === "2026-10-09");
  assert.equal(fri.slots.find((s) => s.time === "10:00").available, false);
  assert.equal(fri.slots.find((s) => s.time === "11:00").available, true);
  assert.deepEqual(availability({ ...S, enabled: false }, "2026-10-07", 7, [], WED_8AM), []);
});

test("schedule validation catches bad admin input and cleans good input", () => {
  assert.match(normalizeSchedule({ start: "16:00", end: "08:00" }).errors.join(), /before the end/);
  assert.match(normalizeSchedule({ start: "8am" }).errors.join(), /times like/);
  assert.match(normalizeSchedule({ slotMinutes: 5 }).errors.join(), /Slot length/);
  assert.match(normalizeSchedule({ enabled: true, days: [] }).errors.join(), /working day/);
  assert.match(normalizeSchedule({ breaks: [{ start: "13:00", end: "12:00" }] }).errors.join(), /break/);
  const ok = normalizeSchedule({ enabled: true, days: [5, 1, 1, 9], blockedDates: ["2026-12-25", "2026-12-25", "2026-01-01"] });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.schedule.days, [1, 5]);
  assert.deepEqual(ok.schedule.blockedDates, ["2026-01-01", "2026-12-25"]);
  assert.match(normalizeSchedule({ blockedDates: ["2026-02-31"] }).errors.join(), /not a valid date/);
});
