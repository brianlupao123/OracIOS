import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { deriveAttendanceKey } from "./secret.js";
import { ATTENDANCE_POLICY } from "./policy.js";

// Raw attendance evidence: ONE append-only list, db.attendance_events.
//
// What an event is: "this technician's badge and PIN were presented at this server time, and the signed-in user
// who presented them was X". That is all. It is not hours, not certified time, not billable time, not payroll,
// not invoice or completion evidence. There is deliberately no `hours`, `rate` or `cost` field anywhere.
//
// Immutability:
//  * appendEvent() is the only writer. This module exports no update or delete. A test fails the build if any
//    other attendance file mutates the list.
//  * Time is the SERVER's (nowMs from requestNowMs in the handler). A client cannot supply or influence it.
//  * Every event carries seq (1, 2, 3 ... with no gaps) and a chain tag:
//      event_hash = HMAC-SHA256(server key, prev_hash | canonical(fields))
//    so editing, deleting, inserting or reordering any stored event is detected by verifyChain(). The key is
//    derived from ORAC_ATTENDANCE_SECRET, so someone who can only edit the database cannot recompute the tags.
//  * Honest limit: removing the NEWEST events leaves a shorter, still-valid chain. Detect that by recording
//    verifyChain().head somewhere outside the database (e.g. a printed weekly report) and comparing later.
//  * A correction is never an edit: it is a separate record (Supervisor review, commit 4) that points at an event.
export const EVENT_TYPES = Object.freeze(["clock_in", "clock_out"]);
export const CAPTURE_CHANNELS = Object.freeze(["self_phone", "shared_kiosk"]);
export const GENESIS_HASH = "0".repeat(64);
const CLIENT_EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// The fields the tag covers, in a fixed order. Adding a field later means a new chain version, never a silent change.
const SIGNED_FIELDS = ["seq", "id", "technician_id", "badge_id", "dispatch_card_id", "event_type", "server_time", "site_date",
  "recorded_by_user_id", "capture_channel", "client_event_id"];

function tag(prevHash, event) {
  const canonical = JSON.stringify(SIGNED_FIELDS.map((key) => event[key] ?? null));
  return createHmac("sha256", deriveAttendanceKey("chain-v1")).update(`ORAC-ATTENDANCE-EVENT|v1|${prevHash}|${canonical}`).digest("hex");
}

// Label only (which calendar day at the site). It is never used to compute hours.
export function siteDate(nowMs, offsetMinutes = ATTENDANCE_POLICY.site_utc_offset_minutes) {
  return new Date(nowMs + offsetMinutes * 60000).toISOString().slice(0, 10);
}

function fail(status, code, message) { return Object.assign(new Error(message), { status, code }); }

export function eventsOf(db) { return Array.isArray(db.attendance_events) ? db.attendance_events : []; }

export function findByClientEventId(db, technicianId, clientEventId) {
  return eventsOf(db).find((e) => e.technician_id === technicianId && e.client_event_id === clientEventId) || null;
}

// Appends one event. `input` is validated here as defence in depth; handlers validate first.
// A retry with the same client_event_id and the same content returns the ORIGINAL event ({ replay: true }) and writes
// nothing. The same id with different content is a conflict (409). The id is scoped to the technician.
export function appendEvent(db, input, { nowMs }) {
  if (!Array.isArray(db.attendance_events)) db.attendance_events = [];
  if (!EVENT_TYPES.includes(input.event_type)) throw fail(400, "ATTENDANCE_BAD_EVENT", "Unknown attendance event type.");
  if (!CAPTURE_CHANNELS.includes(input.capture_channel)) throw fail(400, "ATTENDANCE_BAD_EVENT", "Unknown capture channel.");
  for (const key of ["technician_id", "badge_id", "recorded_by_user_id"]) {
    if (typeof input[key] !== "string" || !input[key]) throw fail(400, "ATTENDANCE_BAD_EVENT", `${key} is required.`);
  }
  if (typeof input.client_event_id !== "string" || !CLIENT_EVENT_ID.test(input.client_event_id)) {
    throw fail(400, "ATTENDANCE_BAD_EVENT", "client_event_id must be a UUID version 4.");
  }
  if (!Number.isFinite(nowMs)) throw fail(500, "ATTENDANCE_BAD_EVENT", "A server time is required.");

  const prior = findByClientEventId(db, input.technician_id, input.client_event_id);
  if (prior) {
    const same = prior.event_type === input.event_type && (prior.dispatch_card_id ?? null) === (input.dispatch_card_id ?? null) &&
      prior.badge_id === input.badge_id && prior.capture_channel === input.capture_channel && prior.recorded_by_user_id === input.recorded_by_user_id;
    if (!same) throw fail(409, "ATTENDANCE_EVENT_ID_REUSED", "That submission reference was already used for a different attendance event.");
    return { event: prior, replay: true };
  }

  const last = db.attendance_events[db.attendance_events.length - 1];
  const event = {
    seq: last ? last.seq + 1 : 1,
    id: `aev_${randomBytes(9).toString("base64url")}`,
    technician_id: input.technician_id,
    badge_id: input.badge_id,
    dispatch_card_id: input.dispatch_card_id ?? null,
    event_type: input.event_type,
    server_time: new Date(nowMs).toISOString(),
    site_date: siteDate(nowMs),
    recorded_by_user_id: input.recorded_by_user_id,
    capture_channel: input.capture_channel,
    client_event_id: input.client_event_id,
    prev_hash: last ? last.event_hash : GENESIS_HASH
  };
  event.event_hash = tag(event.prev_hash, event);
  db.attendance_events.push(Object.freeze(event));
  return { event, replay: false };
}

// Returns { ok, count, head, problems: [{ seq, id, problem }] }. Reads only.
export function verifyChain(db) {
  const events = eventsOf(db);
  const problems = [];
  let prev = GENESIS_HASH;
  const seenIds = new Set();
  events.forEach((event, index) => {
    const note = (problem) => problems.push({ seq: event?.seq ?? null, id: event?.id ?? null, problem });
    if (!event || typeof event !== "object") return note("not_an_event");
    if (event.seq !== index + 1) note("seq_gap_or_reorder");
    if (seenIds.has(event.id)) note("duplicate_id");
    seenIds.add(event.id);
    if (event.prev_hash !== prev) note("prev_hash_mismatch");
    const expected = tag(event.prev_hash ?? "", event);
    const a = Buffer.from(expected); const b = Buffer.from(String(event.event_hash ?? ""));
    if (a.length !== b.length || !timingSafeEqual(a, b)) note("hash_mismatch");
    prev = typeof event.event_hash === "string" ? event.event_hash : prev;
  });
  const last = events[events.length - 1];
  return { ok: problems.length === 0, count: events.length, head: last ? { seq: last.seq, event_hash: last.event_hash } : null, problems };
}
