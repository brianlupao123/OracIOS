// Pure scheduling logic for site-survey slots. No I/O, and it never uses the server's local time zone:
// every date is a "YYYY-MM-DD" string and every time an "HH:MM" string in the business's time zone
// (Zimbabwe, UTC+2, no daylight saving). Design adapted from MediVital's availability service.

export const DEFAULT_SCHEDULE = {
  enabled: false, // online slot booking stays OFF until staff set the real hours in /admin
  utcOffsetMinutes: 120, // Africa/Harare
  days: [1, 2, 3, 4, 5], // 0 = Sunday ... 6 = Saturday
  start: "08:00", // PLACEHOLDER hours: Orac must set the real ones before turning booking on
  end: "16:00",
  slotMinutes: 60,
  capacity: 1, // how many surveys can be booked into the same slot
  breaks: [], // e.g. [{ start: "12:00", end: "13:00" }]
  leadHours: 24, // no bookings sooner than this
  horizonDays: 30, // no bookings further ahead than this
  blockedDates: [], // holidays, shutdowns: ["2026-12-25"]
};

export const ACTIVE_SLOT = new Set(["requested", "confirmed"]); // cancelled slots are released

const pad = (n) => String(n).padStart(2, "0");

export function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ""));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // reject impossible dates such as 2026-02-31
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt : null;
}
const fmt = (dt) => `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
export const weekday = (s) => parseDate(s).getUTCDay();
export const addDays = (s, n) => {
  const d = parseDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
};
const dayNumber = (s) => Math.floor(parseDate(s).getTime() / 86400000);

export function toMinutes(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
export const fromMinutes = (n) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;

// "Now" expressed in the business's time zone, whatever zone the server runs in.
export function localNow(schedule, nowMs = Date.now()) {
  const d = new Date(nowMs + schedule.utcOffsetMinutes * 60000);
  return { date: fmt(d), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

// Validate and clean whatever the admin form sends. Returns { schedule, errors }.
export function normalizeSchedule(input) {
  const s = { ...DEFAULT_SCHEDULE, ...(input && typeof input === "object" ? input : {}) };
  const errors = [];
  const int = (v, min, max, label) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) {
      errors.push(`${label} must be a whole number from ${min} to ${max}.`);
      return DEFAULT_SCHEDULE[label_key[label]];
    }
    return n;
  };
  const label_key = { "Slot length (minutes)": "slotMinutes", "Capacity": "capacity", "Lead time (hours)": "leadHours", "Days ahead": "horizonDays" };

  s.enabled = s.enabled === true;
  s.utcOffsetMinutes = Number.isInteger(Number(s.utcOffsetMinutes)) ? Math.max(-720, Math.min(840, Number(s.utcOffsetMinutes))) : 120;

  s.days = [...new Set((Array.isArray(s.days) ? s.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (s.enabled && s.days.length === 0) errors.push("Choose at least one working day.");

  const a = toMinutes(s.start);
  const b = toMinutes(s.end);
  if (a === null || b === null) errors.push("Start and end must be times like 08:00.");
  else if (a >= b) errors.push("The start time must be before the end time.");

  s.slotMinutes = int(s.slotMinutes, 15, 480, "Slot length (minutes)");
  s.capacity = int(s.capacity, 1, 20, "Capacity");
  s.leadHours = int(s.leadHours, 0, 720, "Lead time (hours)");
  s.horizonDays = int(s.horizonDays, 1, 120, "Days ahead");

  s.breaks = (Array.isArray(s.breaks) ? s.breaks : []).slice(0, 5).flatMap((br) => {
    const x = toMinutes(br?.start);
    const y = toMinutes(br?.end);
    if (x === null || y === null || x >= y) {
      errors.push("Each break needs a start before its end.");
      return [];
    }
    return [{ start: fromMinutes(x), end: fromMinutes(y) }];
  });

  const dates = new Set();
  for (const d of Array.isArray(s.blockedDates) ? s.blockedDates.slice(0, 400) : []) {
    if (parseDate(d)) dates.add(d);
    else errors.push(`"${d}" is not a valid date.`);
  }
  s.blockedDates = [...dates].sort();

  if (a !== null && b !== null && a < b && s.slotMinutes > b - a) errors.push("The slot is longer than the working day.");

  return { schedule: s, errors };
}

// The start times of every slot in a normal working day.
export function slotTimes(schedule) {
  const out = [];
  const a = toMinutes(schedule.start);
  const b = toMinutes(schedule.end);
  if (a === null || b === null) return out;
  for (let t = a; t + schedule.slotMinutes <= b; t += schedule.slotMinutes) {
    const inBreak = schedule.breaks.some((br) => t < toMinutes(br.end) && t + schedule.slotMinutes > toMinutes(br.start));
    if (!inBreak) out.push(fromMinutes(t));
  }
  return out;
}

// Can this exact date+time be booked right now? `bookings` = existing records that have slotDate/slotTime.
export function checkSlot(schedule, date, time, bookings, nowMs = Date.now()) {
  if (!schedule.enabled) return { ok: false, reason: "Online booking is not available." };
  if (!parseDate(date)) return { ok: false, reason: "That date is not valid." };
  if (!schedule.days.includes(weekday(date))) return { ok: false, reason: "That is not a working day." };
  if (schedule.blockedDates.includes(date)) return { ok: false, reason: "That date is not available." };
  if (!slotTimes(schedule).includes(time)) return { ok: false, reason: "That is not an available time." };

  const now = localNow(schedule, nowMs);
  const slotAt = dayNumber(date) * 1440 + toMinutes(time);
  const earliest = dayNumber(now.date) * 1440 + now.minutes + schedule.leadHours * 60;
  if (slotAt < earliest) return { ok: false, reason: "That time is too soon to book online." };
  if (date > addDays(now.date, schedule.horizonDays)) return { ok: false, reason: "That date is too far ahead." };

  const taken = bookings.filter((b) => b.slotDate === date && b.slotTime === time && ACTIVE_SLOT.has(b.slotStatus)).length;
  if (taken >= schedule.capacity) return { ok: false, reason: "That time has just been taken." };
  return { ok: true };
}

// Days that have at least one working slot, with each slot marked available or not.
export function availability(schedule, fromDate, days, bookings, nowMs = Date.now()) {
  if (!schedule.enabled) return [];
  const today = localNow(schedule, nowMs).date;
  const start = parseDate(fromDate) && fromDate > today ? fromDate : today;
  const count = Math.max(1, Math.min(60, Number(days) || 21, schedule.horizonDays + 1));
  const times = slotTimes(schedule);
  const out = [];
  for (let i = 0; i < count; i++) {
    const date = addDays(start, i);
    if (!schedule.days.includes(weekday(date)) || schedule.blockedDates.includes(date)) continue;
    out.push({ date, slots: times.map((time) => ({ time, available: checkSlot(schedule, date, time, bookings, nowMs).ok })) });
  }
  return out;
}
