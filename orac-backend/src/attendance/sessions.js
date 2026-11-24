import { ATTENDANCE_POLICY } from "./policy.js";
import { eventsOf } from "./eventStore.js";

// DERIVED view over the raw events. Nothing here is stored, so it can never drift from the evidence.
//
// A session pairs a clock_in with the next clock_out for the same technician. It reports ELAPSED seconds between
// two server timestamps: a raw interval, not hours worked. It is never certified, approved, billable or payable,
// and no other part of ORAC reads it. The field is called elapsed_seconds (not hours) on purpose.
//
// Anything odd is reported, never repaired: a clock_in followed by another clock_in leaves the first session
// "unclosed" (nobody invents a clock-out time); a clock_out with nothing open is an "orphan_clock_out"; a session
// open longer than max_open_shift_hours is "open_overdue" (still open, flagged for a Supervisor).
export function deriveSessions(db, { nowMs, technicianId } = {}) {
  const maxMs = ATTENDANCE_POLICY.max_open_shift_hours * 3600000;
  const open = new Map(); const sessions = [];
  const view = (event) => ({ id: event.id, seq: event.seq, at: event.server_time });
  for (const event of eventsOf(db)) {
    if (technicianId && event.technician_id !== technicianId) continue;
    const current = open.get(event.technician_id);
    if (event.event_type === "clock_in") {
      if (current) { current.status = "unclosed"; current.flags.push("next_clock_in_without_clock_out"); }
      const session = { technician_id: event.technician_id, dispatch_card_id: event.dispatch_card_id, site_date: event.site_date,
        status: "open", clock_in: view(event), clock_out: null, elapsed_seconds: null, flags: [], evidence_only: true };
      open.set(event.technician_id, session); sessions.push(session);
    } else if (current) {
      current.clock_out = view(event);
      current.elapsed_seconds = Math.max(0, Math.round((Date.parse(event.server_time) - Date.parse(current.clock_in.at)) / 1000));
      current.status = "closed";
      if (current.elapsed_seconds * 1000 > maxMs) current.flags.push("longer_than_max_shift");
      if (current.dispatch_card_id && event.dispatch_card_id && event.dispatch_card_id !== current.dispatch_card_id) current.flags.push("clock_out_on_different_dispatch");
      open.delete(event.technician_id);
    } else {
      sessions.push({ technician_id: event.technician_id, dispatch_card_id: event.dispatch_card_id, site_date: event.site_date,
        status: "orphan_clock_out", clock_in: null, clock_out: view(event), elapsed_seconds: null, flags: ["clock_out_without_clock_in"], evidence_only: true });
    }
  }
  if (Number.isFinite(nowMs)) {
    for (const session of open.values()) {
      if (session.status === "open" && nowMs - Date.parse(session.clock_in.at) > maxMs) { session.status = "open_overdue"; session.flags.push("open_longer_than_max_shift"); }
    }
  }
  return sessions;
}

// What a technician may do next. Used by the clock handlers (commit 3).
//   in  : the last event is a clock_in that is still within max_open_shift_hours -> only clock_out is allowed
//   out : otherwise (never clocked, last event was a clock_out, or an overdue open session) -> clock_in is allowed
export function clockState(db, technicianId, nowMs) {
  const mine = eventsOf(db).filter((e) => e.technician_id === technicianId);
  const last = mine[mine.length - 1];
  if (!last || last.event_type === "clock_out") return { state: "out", open: null, overdue: null };
  const age = nowMs - Date.parse(last.server_time);
  const open = { event_id: last.id, dispatch_card_id: last.dispatch_card_id, since: last.server_time };
  if (age > ATTENDANCE_POLICY.max_open_shift_hours * 3600000) return { state: "out", open: null, overdue: open };
  return { state: "in", open, overdue: null };
}
