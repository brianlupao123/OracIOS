/**
 * Gantt Scheduling Service.
 *
 * Transforms dispatch cards and roster data into timeline-ready
 * structures for the Visual Gantt chart in the frontend.
 *
 * Key features:
 *  - buildGanttTimeline():    Returns dispatch bars grouped by technician,
 *                             with start/end, duration, status colour, and
 *                             mine/client context. Unassigned dispatches
 *                             appear in a separate "Unassigned" swim-lane.
 *  - getResourceUtilisation(): Per-technician workload metrics — scheduled
 *                              days, utilisation %, and over-commitment
 *                              warnings when multiple dispatches overlap.
 *  - detectSchedulingConflicts(): Identifies technicians double-booked on
 *                                 overlapping date ranges.
 *  - rescheduleDispatch():     Moves a dispatch's scheduled_start/end
 *                              (the drag-drop backend for the Gantt UI).
 *
 * Zero-dependency. Operates on the in-memory db collections only.
 */

import crypto from "node:crypto";

// ── Status → colour mapping (matches Jobs Tracker 14 colours) ──────

const STATUS_COLOURS = {
  Draft:               "#9e9e9e",
  Scheduled:           "#42a5f5",
  Mobilising:          "#ffa726",
  WIP:                 "#66bb6a",
  Demobilised:         "#ef5350",
  Completed:           "#4caf50",
  Cancelled:           "#bdbdbd",
  Ready_For_Invoice:   "#7e57c2",
  Invoiced:            "#26a69a"
};

function statusColour(status) {
  return STATUS_COLOURS[status] || "#78909c";
}

// ── Helpers ─────────────────────────────────────────────────────────

function parseDate(d) {
  if (!d) return null;
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt;
}

function daysBetween(start, end) {
  if (!start || !end) return 0;
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function dateRangesOverlap(s1, e1, s2, e2) {
  return s1 <= e2 && s2 <= e1;
}

/**
 * Infer scheduled_end from dispatch data.  Many dispatches only have
 * scheduled_start; we fall back to estimated_duration_days or default 1.
 */
function inferEnd(dispatch) {
  if (dispatch.scheduled_end) return parseDate(dispatch.scheduled_end);
  const start = parseDate(dispatch.scheduled_start);
  if (!start) return null;
  const days = dispatch.estimated_duration_days || 1;
  const end = new Date(start);
  end.setDate(end.getDate() + days);
  return end;
}

// ── Core: Build Gantt Timeline ──────────────────────────────────────

/**
 * Returns a Gantt-ready data structure:
 * {
 *   resources: [{ id, name, trade, type: "technician"|"unassigned" }],
 *   bars: [{ id, resourceId, dispatchId, label, start, end, days,
 *            status, colour, mine, client, quotationRef }],
 *   range: { earliest, latest }
 * }
 *
 * @param {Object} options
 * @param {string} [options.startDate] - filter: only dispatches overlapping this range
 * @param {string} [options.endDate]   - filter: end of range
 * @param {string} [options.technicianId] - filter: single technician
 * @param {Object} options.db
 */
export function buildGanttTimeline({ startDate, endDate, technicianId, db }) {
  const dispatches = db.dispatch_cards || [];
  const users = db.users || [];
  const quotes = db.quotations || [];
  const clients = db.clients || [];

  const filterStart = parseDate(startDate);
  const filterEnd   = parseDate(endDate);

  // Map technicians by ID
  const techMap = new Map();
  for (const u of users) {
    if (u.role === "Technician" && u.is_active !== false) {
      techMap.set(u.id, { id: u.id, name: u.name || u.id, trade: u.trade || null });
    }
  }

  const resources = [];      // swim-lanes
  const bars = [];            // Gantt bars
  let earliest = null;
  let latest   = null;

  // Track which technicians have bars
  const seenTechIds = new Set();

  for (const d of dispatches) {
    const dStart = parseDate(d.scheduled_start);
    const dEnd   = inferEnd(d);
    if (!dStart) continue;  // Can't render without a start date

    const effectiveEnd = dEnd || dStart;

    // Date range filter
    if (filterStart && filterEnd && !dateRangesOverlap(dStart, effectiveEnd, filterStart, filterEnd)) {
      continue;
    }

    // Track overall range
    if (!earliest || dStart < earliest) earliest = dStart;
    if (!latest || effectiveEnd > latest) latest = effectiveEnd;

    // Gather all technicians for this dispatch
    const techIds = new Set();
    if (d.assigned_technician_id) techIds.add(d.assigned_technician_id);
    for (const tid of (d.assigned_technician_ids || [])) techIds.add(tid);

    // Technician filter
    if (technicianId && !techIds.has(technicianId)) continue;

    // Look up quote/client for label
    const quote  = quotes.find(q => q.id === d.quotation_id);
    const client = clients.find(c => c.id === (d.client_id || (quote && quote.client_id)));

    const baseBar = {
      dispatchId:   d.id,
      label:        d.site_name || d.description || d.id,
      start:        dStart.toISOString().split("T")[0],
      end:          effectiveEnd.toISOString().split("T")[0],
      days:         daysBetween(dStart, effectiveEnd),
      status:       d.status || "Draft",
      colour:       statusColour(d.status || "Draft"),
      mine:         d.mine_name || d.site_name || null,
      client:       client ? (client.name || client.company_name || null) : null,
      quotationRef: quote ? (quote.quote_number || quote.id) : null
    };

    if (techIds.size === 0) {
      // Unassigned dispatch (skip if filtering by technician)
      if (!technicianId) {
        bars.push({
          id: `bar_${d.id}_unassigned`,
          resourceId: "__unassigned__",
          ...baseBar
        });
      }
    } else {
      // When filtering by technician, only create bar for that technician
      const renderIds = technicianId ? [technicianId].filter(t => techIds.has(t)) : [...techIds];
      for (const tid of renderIds) {
        seenTechIds.add(tid);
        bars.push({
          id: `bar_${d.id}_${tid}`,
          resourceId: tid,
          ...baseBar
        });
      }
    }
  }

  // Build resources list from technicians who have bars
  for (const tid of seenTechIds) {
    const tech = techMap.get(tid);
    resources.push(tech
      ? { ...tech, type: "technician" }
      : { id: tid, name: tid, trade: null, type: "technician" }
    );
  }

  // Add unassigned lane if needed
  if (bars.some(b => b.resourceId === "__unassigned__")) {
    resources.unshift({ id: "__unassigned__", name: "Unassigned", trade: null, type: "unassigned" });
  }

  // Sort resources by name
  resources.sort((a, b) => {
    if (a.type === "unassigned") return -1;
    if (b.type === "unassigned") return 1;
    return (a.name || "").localeCompare(b.name || "");
  });

  return {
    resources,
    bars,
    range: {
      earliest: earliest ? earliest.toISOString().split("T")[0] : null,
      latest:   latest   ? latest.toISOString().split("T")[0]   : null
    }
  };
}

// ── Resource Utilisation ────────────────────────────────────────────

/**
 * Per-technician utilisation for a date range.
 * Returns [{ technicianId, name, scheduledDays, totalDays, utilisation,
 *            dispatchCount, overCommitted }]
 */
export function getResourceUtilisation({ startDate, endDate, db }) {
  const start = parseDate(startDate);
  const end   = parseDate(endDate);
  if (!start || !end) {
    throw Object.assign(new Error("startDate and endDate are required"), { status: 400 });
  }

  const totalDays = daysBetween(start, end);
  const dispatches = db.dispatch_cards || [];
  const users = db.users || [];

  // Aggregate per technician
  const techStats = new Map();

  for (const d of dispatches) {
    const dStart = parseDate(d.scheduled_start);
    const dEnd   = inferEnd(d);
    if (!dStart || !dEnd) continue;
    if (!dateRangesOverlap(dStart, dEnd, start, end)) continue;
    if (d.status === "Cancelled") continue;

    const techIds = new Set();
    if (d.assigned_technician_id) techIds.add(d.assigned_technician_id);
    for (const tid of (d.assigned_technician_ids || [])) techIds.add(tid);

    for (const tid of techIds) {
      if (!techStats.has(tid)) techStats.set(tid, { scheduledDays: 0, dispatches: [] });
      const stat = techStats.get(tid);
      // Clamp to query range
      const clampStart = dStart < start ? start : dStart;
      const clampEnd   = dEnd > end ? end : dEnd;
      stat.scheduledDays += daysBetween(clampStart, clampEnd);
      stat.dispatches.push({ id: d.id, start: dStart, end: dEnd });
    }
  }

  const result = [];
  for (const [tid, stat] of techStats) {
    const user = users.find(u => u.id === tid);
    // Check for overlapping dispatches (over-commitment)
    let overCommitted = false;
    for (let i = 0; i < stat.dispatches.length && !overCommitted; i++) {
      for (let j = i + 1; j < stat.dispatches.length; j++) {
        if (dateRangesOverlap(stat.dispatches[i].start, stat.dispatches[i].end,
                              stat.dispatches[j].start, stat.dispatches[j].end)) {
          overCommitted = true;
          break;
        }
      }
    }

    result.push({
      technicianId:  tid,
      name:          user ? (user.name || tid) : tid,
      scheduledDays: stat.scheduledDays,
      totalDays,
      utilisation:   Math.round((stat.scheduledDays / totalDays) * 100),
      dispatchCount: stat.dispatches.length,
      overCommitted
    });
  }

  return result.sort((a, b) => b.utilisation - a.utilisation);
}

// ── Scheduling Conflicts ────────────────────────────────────────────

/**
 * Returns all technicians with overlapping dispatch assignments.
 */
export function detectSchedulingConflicts({ db }) {
  const dispatches = db.dispatch_cards || [];
  const users = db.users || [];

  // Build per-technician dispatch list
  const techDispatches = new Map();
  for (const d of dispatches) {
    const dStart = parseDate(d.scheduled_start);
    const dEnd   = inferEnd(d);
    if (!dStart || !dEnd) continue;
    if (d.status === "Cancelled") continue;

    const techIds = new Set();
    if (d.assigned_technician_id) techIds.add(d.assigned_technician_id);
    for (const tid of (d.assigned_technician_ids || [])) techIds.add(tid);

    for (const tid of techIds) {
      if (!techDispatches.has(tid)) techDispatches.set(tid, []);
      techDispatches.get(tid).push({ dispatchId: d.id, start: dStart, end: dEnd,
        label: d.site_name || d.description || d.id });
    }
  }

  const conflicts = [];
  for (const [tid, assignments] of techDispatches) {
    for (let i = 0; i < assignments.length; i++) {
      for (let j = i + 1; j < assignments.length; j++) {
        if (dateRangesOverlap(assignments[i].start, assignments[i].end,
                              assignments[j].start, assignments[j].end)) {
          const user = users.find(u => u.id === tid);
          conflicts.push({
            technicianId: tid,
            technicianName: user ? (user.name || tid) : tid,
            dispatch1: { id: assignments[i].dispatchId, label: assignments[i].label,
              start: assignments[i].start.toISOString().split("T")[0],
              end: assignments[i].end.toISOString().split("T")[0] },
            dispatch2: { id: assignments[j].dispatchId, label: assignments[j].label,
              start: assignments[j].start.toISOString().split("T")[0],
              end: assignments[j].end.toISOString().split("T")[0] }
          });
        }
      }
    }
  }

  return conflicts;
}

// ── Reschedule (Drag-Drop) ──────────────────────────────────────────

/**
 * Moves a dispatch's scheduled dates. The Gantt front-end drag-drop
 * calls this when a bar is moved.
 *
 * @returns the updated dispatch card
 */
export function rescheduleDispatch({ dispatchId, newStart, newEnd, userId, store, db }) {
  if (!dispatchId) throw Object.assign(new Error("dispatchId is required"), { status: 400 });
  if (!newStart)   throw Object.assign(new Error("newStart is required"),   { status: 400 });

  const dispatch = (db.dispatch_cards || []).find(d => d.id === dispatchId);
  if (!dispatch) throw Object.assign(new Error("Dispatch card not found"), { status: 404 });

  const start = parseDate(newStart);
  const end   = newEnd ? parseDate(newEnd) : null;
  if (!start) throw Object.assign(new Error("Invalid newStart date"), { status: 400 });
  if (end && end < start) {
    throw Object.assign(new Error("newEnd must be on or after newStart"), { status: 400 });
  }

  const before = { scheduled_start: dispatch.scheduled_start, scheduled_end: dispatch.scheduled_end };

  dispatch.scheduled_start = start.toISOString().split("T")[0];
  if (end) {
    dispatch.scheduled_end = end.toISOString().split("T")[0];
  } else if (dispatch.estimated_duration_days) {
    const autoEnd = new Date(start);
    autoEnd.setDate(autoEnd.getDate() + dispatch.estimated_duration_days);
    dispatch.scheduled_end = autoEnd.toISOString().split("T")[0];
  }
  dispatch.updated_at = new Date().toISOString();

  if (store && store.audit) {
    store.audit(db, { id: userId || "system" }, "dispatch_card", dispatch.id,
      "DISPATCH_RESCHEDULED", before, {
        scheduled_start: dispatch.scheduled_start,
        scheduled_end: dispatch.scheduled_end
      });
  }

  return dispatch;
}
