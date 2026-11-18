// Survey-slot logic that works directly on IOS's single data object (`req.db`).
// IOS saves every write request inside one database transaction that holds `SELECT ... FOR UPDATE` on the
// data row (see postgresStore.js), so "check the slot, then book it" inside one handler is atomic, even across
// several server instances. These functions are pure: they only read/modify the `db` object they are given.
import crypto from "node:crypto";
import { DEFAULT_SCHEDULE, normalizeSchedule, checkSlot, availability, ACTIVE_SLOT } from "./schedule.js";

export const SLOT_STATUSES = ["requested", "confirmed", "cancelled"];

// New collections are created on first use, so IOS's store.js / seed data need no changes.
export function ensureBookingState(db) {
  if (!Array.isArray(db.survey_bookings)) db.survey_bookings = [];
  if (!db.booking_settings || typeof db.booking_settings !== "object") db.booking_settings = { ...DEFAULT_SCHEDULE };
  return db;
}

export const getSchedule = (db) => normalizeSchedule(ensureBookingState(db).booking_settings).schedule;

// schedule.js speaks camelCase; IOS collections use snake_case.
const asHeld = (bookings) => bookings.map((b) => ({ slotDate: b.slot_date, slotTime: b.slot_time, slotStatus: b.slot_status }));

export function saveSchedule(db, input) {
  const { schedule, errors } = normalizeSchedule(input);
  if (errors.length) return { ok: false, errors };
  ensureBookingState(db).booking_settings = schedule;
  return { ok: true, schedule };
}

// What the public website may see: free or taken times only, never who booked.
export function publicAvailability(db, fromDate, days, nowMs = Date.now()) {
  const schedule = getSchedule(db);
  return {
    enabled: schedule.enabled,
    slotMinutes: schedule.slotMinutes,
    timezone: "Zimbabwe time (UTC+2)",
    days: availability(schedule, fromDate, days, asHeld(db.survey_bookings), nowMs),
  };
}

// Would this slot be accepted right now? (no change to db)
export const checkBooking = (db, date, time, nowMs = Date.now()) =>
  checkSlot(getSchedule(db), date, time, asHeld(ensureBookingState(db).survey_bookings), nowMs);

// record: { slotDate, slotTime, name, company, email, phone, siteLocation, surveyType, message }
export function bookSlot(db, record, { id, leadId, reference, nowMs = Date.now() }) {
  const verdict = checkBooking(db, record.slotDate, record.slotTime, nowMs);
  if (!verdict.ok) return { ok: false, problem: verdict.reason };
  const stamp = new Date(nowMs).toISOString();
  const booking = {
    id,
    reference: reference || crypto.randomBytes(4).toString("hex").toUpperCase(),
    lead_id: leadId || null,
    contact_name: record.name,
    company_name: record.company || "",
    email: record.email || "",
    phone: record.phone || "",
    site_location: record.siteLocation || "",
    survey_type: record.surveyType || "",
    notes: record.message || "",
    slot_date: record.slotDate,
    slot_time: record.slotTime,
    slot_status: "requested",
    source: "website",
    created_at: stamp,
    updated_at: stamp,
  };
  db.survey_bookings.push(booking);
  return { ok: true, booking };
}

// Staff confirm or cancel. Re-activating a cancelled slot is refused if another request holds it since.
export function setSlotStatus(db, id, status, nowMs = Date.now()) {
  ensureBookingState(db);
  if (!SLOT_STATUSES.includes(status)) return { ok: false, code: 400, problem: "Invalid status." };
  const booking = db.survey_bookings.find((b) => b.id === id);
  if (!booking) return { ok: false, code: 404, problem: "Booking not found." };
  if (ACTIVE_SLOT.has(status) && !ACTIVE_SLOT.has(booking.slot_status)) {
    const holders = db.survey_bookings.filter(
      (b) => b.id !== id && b.slot_date === booking.slot_date && b.slot_time === booking.slot_time && ACTIVE_SLOT.has(b.slot_status)
    ).length;
    if (holders >= getSchedule(db).capacity) return { ok: false, code: 409, problem: "That slot has been taken by another request." };
  }
  const before = { ...booking };
  booking.slot_status = status;
  booking.updated_at = new Date(nowMs).toISOString();
  return { ok: true, booking, before };
}
