import { requirePermission, roles } from "../permissions.js";
import { requestNowMs, IDEMPOTENCY_REPLAY_HEADER } from "../idempotency.js";
import { attendanceEnabled, featureDisabled } from "./flag.js";
import { verifyBadgeToken } from "./badge.js";
import { validatePinFormat } from "./pin.js";
import { authenticateBadgeAndPin, INVALID } from "./credentials.js";
import { appendEvent, findByClientEventId, eventsOf } from "./eventStore.js";
import { clockState } from "./sessions.js";

// Clock-in / clock-out. Evidence only: each accepted action appends ONE raw event through appendEvent(), the single
// writer of the immutable chain. Nothing here computes, stores or returns hours, and nothing else in ORAC reads the
// result. Order of every handler: permission, dark flag, request shape, badge + PIN, replay, state guard, append.
//
//  * Time is the server's (requestNowMs). The request body has no time, sequence, hash or channel field, and the
//    schema strips anything extra.
//  * capture_channel is derived, never supplied: the technician presenting their OWN badge on their own signed-in
//    session is "self_phone"; any other signed-in user (a Supervisor) presenting a badge is "shared_kiosk".
//    A Technician session can only ever present that technician's own badge.
//  * Retry safety is the event store's client_event_id (UUID v4, scoped to the technician). A retry of an action
//    that was already saved still needs the badge + PIN, then returns the ORIGINAL event with 200 and writes
//    nothing. The replay check runs BEFORE the state guard, otherwise a lost-response retry of a clock_in would be
//    refused as "already clocked in".
//  * State comes from clockState(): clock_in is refused while a shift is open, clock_out while none is. An open
//    shift older than max_open_shift_hours is "out" for clockState, so clock_out is refused with its own code
//    (Supervisor review, never an automatic or invented clock-out) and clock_in stays possible, which the derived
//    sessions then report as "unclosed". The whole read-check-append runs inside the request's store lock
//    (persistenceMiddleware), so two simultaneous requests cannot both pass the guard.
//  * Wrong-PIN counters are saved although the answer is an error (req.persistOnFailure), exactly like the PIN
//    change handler. A refused action (state, dispatch, id reuse) saves nothing.
function getActor(req) {
  return req.user?.id ? req.db.users.find((user) => user.id === req.user.id) : null;
}

function refuse(res, status, code, message, extra = {}) {
  return res.status(status).json({ success: false, code, message, ...extra });
}

// attempts_remaining is deliberately NOT forwarded: it exists only when the badge was valid, so it would tell a
// caller which half of "badge or PIN" was wrong. The lock wait is forwarded (a holder needs it).
function refuseCredentials(res, auth) {
  const extra = auth.retry_after_seconds !== undefined ? { retry_after_seconds: auth.retry_after_seconds } : {};
  return refuse(res, auth.status, auth.code, auth.message, extra);
}

// A Technician session may present only that technician's own badge. Checked BEFORE any PIN is verified, so a
// stolen or photographed badge presented from another technician's session cannot spend (or lock) the owner's PIN.
function badgeIsOwnedBy(db, badgeToken, technicianId, nowMs) {
  const token = verifyBadgeToken(badgeToken, nowMs);
  if (!token.ok) return true; // unreadable/forged/expired: authenticateBadgeAndPin gives the one uniform refusal
  const badge = (db.attendance_badges || []).find((row) => row.id === token.badgeId);
  return Boolean(badge) && badge.technician_id === technicianId;
}

function eventView(event) {
  return {
    id: event.id, seq: event.seq, event_type: event.event_type, server_time: event.server_time, site_date: event.site_date,
    dispatch_card_id: event.dispatch_card_id, capture_channel: event.capture_channel
  };
}

function clockAction(eventType) {
  return async function clockHandler(req, res) {
    const actor = getActor(req); requirePermission(actor, "clockAttendance");
    if (!attendanceEnabled()) return featureDisabled(res);
    const body = req.body;
    const formatError = validatePinFormat(body.pin);
    if (formatError) return res.status(400).json({ success: false, message: formatError });
    const nowMs = requestNowMs(req);
    const clientEventId = body.client_event_id.toLowerCase();

    if (actor.role === roles.TECHNICIAN && !badgeIsOwnedBy(req.db, body.badge_token, actor.id, nowMs)) {
      return refuseCredentials(res, INVALID);
    }
    const auth = await authenticateBadgeAndPin(req.db, { badgeToken: body.badge_token, pin: body.pin }, nowMs);
    if (!auth.ok) {
      if (auth.persist) {
        req.persistOnFailure = true;
        req.store.audit(req.db, actor, "attendance_pin", auth.technician.id,
          auth.failure === "locked" ? "ATTENDANCE_PIN_LOCKED" : "ATTENDANCE_PIN_FAILED", null, { context: eventType });
      }
      return refuseCredentials(res, auth);
    }

    const technician = auth.technician;
    const dispatchCardId = body.dispatch_card_id ?? null;
    const input = {
      technician_id: technician.id, badge_id: auth.badge.id, dispatch_card_id: dispatchCardId, event_type: eventType,
      recorded_by_user_id: actor.id, capture_channel: actor.id === technician.id ? "self_phone" : "shared_kiosk",
      client_event_id: clientEventId
    };
    const respondOk = (event, replayed) => {
      const state = clockState(req.db, technician.id, nowMs);
      if (replayed) res.set(IDEMPOTENCY_REPLAY_HEADER, "true");
      res.set("Cache-Control", "no-store");
      return res.status(replayed ? 200 : 201).json({ success: true, data: {
        replayed, event: eventView(event), technician: { id: technician.id, name: technician.name || null },
        state: state.state, open_since: state.open?.since || null, evidence_only: true } });
    };
    const guarded = (fn) => {
      try { return fn(); } catch (error) {
        if (typeof error?.code === "string" && error.code.startsWith("ATTENDANCE_") && error.status < 500) {
          return refuse(res, error.status, error.code, error.message);
        }
        throw error;
      }
    };

    // 1. Retry of something already saved: same content returns the original, different content is a 409.
    if (findByClientEventId(req.db, technician.id, clientEventId)) {
      return guarded(() => { const { event } = appendEvent(req.db, input, { nowMs }); return respondOk(event, true); });
    }

    // 2. A dispatch reference must be a real dispatch card. Whether this technician is assigned to it is NOT checked
    // (the assignment record is outside this packet): owner decision.
    if (dispatchCardId && !(req.db.dispatch_cards || []).some((card) => card.id === dispatchCardId)) {
      return refuse(res, 400, "ATTENDANCE_DISPATCH_UNKNOWN", "That dispatch could not be found.");
    }

    // 3. State guard.
    const current = clockState(req.db, technician.id, nowMs);
    if (eventType === "clock_in" && current.state === "in") {
      return refuse(res, 409, "ATTENDANCE_ALREADY_CLOCKED_IN", "This technician is already clocked in. Clock out first.", { open_since: current.open.since });
    }
    if (eventType === "clock_out" && current.state === "out") {
      return current.overdue
        ? refuse(res, 409, "ATTENDANCE_OPEN_SHIFT_OVERDUE", "The open shift is older than the allowed maximum and cannot be closed here. Ask a Supervisor to review it.", { open_since: current.overdue.since })
        : refuse(res, 409, "ATTENDANCE_NOT_CLOCKED_IN", "This technician is not clocked in.");
    }
    if (eventType === "clock_out" && dispatchCardId && current.open.dispatch_card_id && dispatchCardId !== current.open.dispatch_card_id) {
      return refuse(res, 409, "ATTENDANCE_DISPATCH_MISMATCH", "The open shift was started on a different dispatch.", { open_dispatch_card_id: current.open.dispatch_card_id });
    }
    const mine = eventsOf(req.db).filter((event) => event.technician_id === technician.id);
    const last = mine[mine.length - 1];
    if (last && nowMs < Date.parse(last.server_time)) {
      return refuse(res, 409, "ATTENDANCE_SERVER_CLOCK_BEHIND", "The server clock is behind this technician's last recorded event, so nothing was recorded.");
    }

    // 4. Append (the only write to the evidence chain).
    return guarded(() => { const { event } = appendEvent(req.db, input, { nowMs }); return respondOk(event, false); });
  };
}

export const clockIn = clockAction("clock_in");
export const clockOut = clockAction("clock_out");
