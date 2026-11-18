// Website -> IOS. Public handlers (no login) and staff handlers for survey slots.
// A website visitor becomes a LEAD (never a Client). Sales verifies it and then uses IOS's normal pipeline.
import crypto from "node:crypto";
import { hasPermission, requirePermission } from "../../../permissions.js";
import { validate } from "../booking/validateEnquiry.js";
import { toLead } from "../booking/leadMapper.js";
import { bookSlot, checkBooking, ensureBookingState, getSchedule, publicAvailability, saveSchedule, setSlotStatus } from "../booking/bookingState.js";

// Never fall back to "the first user" (IOS's getActor does). Public calls have NO actor: audit() records "system".
const actorFrom = (req) => (req.user ? req.db.users.find((u) => u.id === req.user.id) || null : null);
// req.nowMs exists only so tests can fix the clock; a client cannot set it.
const clock = (req) => (typeof req.nowMs === "number" ? req.nowMs : Date.now());

// ---------------------------------------------------------------- public (no login)

// GET /public/slots?from=YYYY-MM-DD&days=21
export function getPublicSlots(req, res) {
  const data = publicAvailability(req.db, String(req.query?.from || ""), req.query?.days, clock(req));
  res.json({ success: true, data: data.enabled ? data : { enabled: false, days: [] } });
}

// POST /public/enquiries   (quote | emergency | contact | survey, with an optional booked slot)
export function createWebsiteEnquiry(req, res) {
  const body = req.body;
  // Honeypot: real visitors never fill this hidden field. A non-2xx answer means IOS saves nothing for bots.
  if (body && body.website) return res.status(400).json({ success: false, message: "Request rejected." });

  const { errors, record } = validate(body);
  if (errors.length) return res.status(400).json({ success: false, message: errors.join(" ") });

  const nowMs = clock(req);
  const reference = crypto.randomBytes(4).toString("hex").toUpperCase();
  const store = req.store;
  const leadId = store.id("lead");

  ensureBookingState(req.db);
  let booking = null;
  if (record.slotDate) {
    // Slot check and booking happen here, inside the request that already holds IOS's database lock.
    // If the slot is gone we answer 409 BEFORE touching anything, so nothing is saved.
    const verdict = checkBooking(req.db, record.slotDate, record.slotTime, nowMs);
    if (!verdict.ok) return res.status(409).json({ success: false, slot_taken: true, message: `${verdict.reason} Please choose another time.` });
    const made = bookSlot(req.db, record, { id: store.id("booking"), leadId, reference, nowMs });
    if (!made.ok) return res.status(409).json({ success: false, slot_taken: true, message: `${made.problem} Please choose another time.` });
    booking = made.booking;
  }

  const lead = { id: leadId, ...toLead(record, { reference }), status: "New", created_at: new Date(nowMs).toISOString() };
  req.db.leads.push(lead);
  store.audit(req.db, null, "lead", lead.id, "LEAD_CREATED", null, lead); // null actor -> "system"; also notifies Sales/Admin/Management

  res.json({
    success: true,
    data: { reference, slot: booking ? { date: booking.slot_date, time: booking.slot_time, status: booking.slot_status } : null },
  });
}

// ---------------------------------------------------------------- staff (after authMiddleware)

export function getBookingSettings(req, res) {
  requirePermission(actorFrom(req), "manageBookings");
  res.json({ success: true, data: getSchedule(req.db) });
}

export function updateBookingSettings(req, res) {
  const actor = actorFrom(req);
  requirePermission(actor, "manageBookingSettings");
  const before = getSchedule(req.db);
  const result = saveSchedule(req.db, req.body);
  if (!result.ok) return res.status(400).json({ success: false, message: result.errors.join(" ") });
  req.store.audit(req.db, actor, "booking_settings", "main", "BOOKING_SETTINGS_UPDATED", before, result.schedule);
  res.json({ success: true, data: result.schedule });
}

export function listBookings(req, res) {
  requirePermission(actorFrom(req), "manageBookings");
  ensureBookingState(req.db);
  const { status, from } = req.query || {};
  const rows = req.db.survey_bookings
    .filter((b) => (!status || b.slot_status === status) && (!from || b.slot_date >= from))
    .sort((a, b) => `${a.slot_date} ${a.slot_time}`.localeCompare(`${b.slot_date} ${b.slot_time}`));
  res.json({ success: true, data: rows });
}

export function updateBookingStatus(req, res) {
  const actor = actorFrom(req);
  requirePermission(actor, "manageBookings");
  const result = setSlotStatus(req.db, req.params.id, req.body?.status, clock(req));
  if (!result.ok) return res.status(result.code).json({ success: false, message: result.problem });
  req.store.audit(req.db, actor, "survey_booking", result.booking.id, `SURVEY_SLOT_${result.booking.slot_status.toUpperCase()}`, { slot_status: result.before.slot_status }, { slot_status: result.booking.slot_status });
  res.json({ success: true, data: result.booking });
}

export { hasPermission };
