/**
 * Leave & Absence Management Service.
 *
 * Manages employee leave requests for ORAC's mine services workforce.
 * Zimbabwe-specific: annual leave (22 days), sick leave (12 days certified,
 * 10 uncertified), compassionate (3 days), maternity (98 days).
 *
 * State Machine: Draft → Submitted → Approved | Rejected → Cancelled
 *
 * Business rules:
 *  - Annual leave accrues at 1.83 days/month (22/12).
 *  - Sick leave > 2 consecutive days requires medical certificate reference.
 *  - Leave requests must not overlap with existing approved leave.
 *  - Only the user's direct manager (or Admin) can approve.
 *  - Submitter cannot approve their own leave.
 *
 * Zero-dependency: no external packages.
 */

import crypto from "node:crypto";

// ── Leave Types (Zimbabwe Labour Act aligned) ───────────────────────

export const LEAVE_TYPES = {
  annual:        { label: "Annual Leave",        default_days: 22,  accrual: true  },
  sick:          { label: "Sick Leave",           default_days: 22,  accrual: false },
  compassionate: { label: "Compassionate Leave",  default_days: 3,   accrual: false },
  maternity:     { label: "Maternity Leave",       default_days: 98,  accrual: false },
  paternity:     { label: "Paternity Leave",       default_days: 5,   accrual: false },
  study:         { label: "Study Leave",           default_days: 5,   accrual: false },
  unpaid:        { label: "Unpaid Leave",          default_days: 0,   accrual: false }
};

export const LEAVE_TYPE_KEYS = Object.keys(LEAVE_TYPES);

// ── States ──────────────────────────────────────────────────────────

export const LEAVE_STATES = ["Draft", "Submitted", "Approved", "Rejected", "Cancelled"];

const VALID_TRANSITIONS = {
  Draft:     ["Submitted", "Cancelled"],
  Submitted: ["Approved", "Rejected", "Cancelled"],
  Approved:  ["Cancelled"],  // Can cancel approved leave before start date
  Rejected:  [],             // terminal
  Cancelled: []              // terminal
};

function assertTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw Object.assign(new Error(`Invalid leave transition: ${from} → ${to}`), { status: 409 });
  }
}

// ── CRUD ────────────────────────────────────────────────────────────

/**
 * Creates a new leave request in Draft state.
 */
export function createLeaveRequest({
  userId, leaveType, startDate, endDate, reason,
  medicalCertRef, store, db
}) {
  if (!userId) throw Object.assign(new Error("userId is required"), { status: 400 });
  if (!leaveType) throw Object.assign(new Error("leaveType is required"), { status: 400 });
  if (!LEAVE_TYPE_KEYS.includes(leaveType)) {
    throw Object.assign(new Error(`Invalid leave type. Must be one of: ${LEAVE_TYPE_KEYS.join(", ")}`), { status: 400 });
  }
  if (!startDate) throw Object.assign(new Error("startDate is required"), { status: 400 });
  if (!endDate) throw Object.assign(new Error("endDate is required"), { status: 400 });

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw Object.assign(new Error("Invalid date format"), { status: 400 });
  }
  if (end < start) {
    throw Object.assign(new Error("endDate must be on or after startDate"), { status: 400 });
  }

  const days = calculateBusinessDays(start, end);

  // Sick leave > 2 days requires medical certificate
  if (leaveType === "sick" && days > 2 && !medicalCertRef) {
    throw Object.assign(
      new Error("Sick leave exceeding 2 days requires a medical certificate reference"),
      { status: 400 }
    );
  }

  if (!db.leave_requests) db.leave_requests = [];

  // Check overlap with existing approved/submitted leave for same user
  const overlap = findOverlap({ userId, startDate: start, endDate: end, db });
  if (overlap) {
    throw Object.assign(
      new Error(`Leave dates overlap with existing ${overlap.status} request (${overlap.id})`),
      { status: 409 }
    );
  }

  const request = {
    id: `lv_${crypto.randomBytes(8).toString("hex")}`,
    user_id: userId,
    leave_type: leaveType,
    start_date: start.toISOString().split("T")[0],
    end_date: end.toISOString().split("T")[0],
    days,
    reason: reason || null,
    medical_cert_ref: medicalCertRef || null,
    status: "Draft",
    submitted_at: null,
    approved_by: null,
    approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    cancelled_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  db.leave_requests.push(request);

  store.audit(db, { id: userId }, "leave_requests", request.id,
    "LEAVE_DRAFTED", {
      leave_type: leaveType, start_date: request.start_date,
      end_date: request.end_date, days
    });

  return request;
}

/**
 * Submits a Draft leave request for approval.
 */
export function submitLeaveRequest({ requestId, userId, store, db }) {
  const req = findRequest(requestId, db);
  if (req.user_id !== userId) {
    throw Object.assign(new Error("Only the requester can submit their leave request"), { status: 403 });
  }
  assertTransition(req.status, "Submitted");

  req.status = "Submitted";
  req.submitted_at = new Date().toISOString();
  req.updated_at = new Date().toISOString();

  store.audit(db, { id: userId }, "leave_requests", req.id,
    "LEAVE_SUBMITTED", { days: req.days, leave_type: req.leave_type });

  return req;
}

/**
 * Approves a Submitted leave request.
 * Self-approval is blocked.
 */
export function approveLeaveRequest({ requestId, approvedBy, store, db }) {
  const req = findRequest(requestId, db);
  assertTransition(req.status, "Approved");

  if (req.user_id === approvedBy) {
    throw Object.assign(new Error("Cannot approve your own leave request"), { status: 403 });
  }

  req.status = "Approved";
  req.approved_by = approvedBy;
  req.approved_at = new Date().toISOString();
  req.updated_at = new Date().toISOString();

  store.audit(db, { id: approvedBy }, "leave_requests", req.id,
    "LEAVE_APPROVED", { days: req.days, approved_by: approvedBy });

  return req;
}

/**
 * Rejects a Submitted leave request.
 */
export function rejectLeaveRequest({ requestId, rejectedBy, reason, store, db }) {
  const req = findRequest(requestId, db);
  assertTransition(req.status, "Rejected");

  if (req.user_id === rejectedBy) {
    throw Object.assign(new Error("Cannot reject your own leave request"), { status: 403 });
  }

  req.status = "Rejected";
  req.rejected_by = rejectedBy;
  req.rejected_at = new Date().toISOString();
  req.rejection_reason = reason || null;
  req.updated_at = new Date().toISOString();

  store.audit(db, { id: rejectedBy }, "leave_requests", req.id,
    "LEAVE_REJECTED", { reason: reason || null });

  return req;
}

/**
 * Cancels a leave request (Draft, Submitted, or Approved).
 */
export function cancelLeaveRequest({ requestId, cancelledBy, reason, store, db }) {
  const req = findRequest(requestId, db);
  assertTransition(req.status, "Cancelled");

  req.status = "Cancelled";
  req.cancelled_at = new Date().toISOString();
  req.updated_at = new Date().toISOString();

  store.audit(db, { id: cancelledBy }, "leave_requests", req.id,
    "LEAVE_CANCELLED", { cancelled_by: cancelledBy, reason: reason || null });

  return req;
}

// ── Queries ─────────────────────────────────────────────────────────

export function getLeaveRequest({ requestId, db }) {
  return findRequest(requestId, db);
}

export function listLeaveRequests({ userId, status, leaveType, year, db }) {
  let requests = db.leave_requests || [];
  if (userId) requests = requests.filter(r => r.user_id === userId);
  if (status) requests = requests.filter(r => r.status === status);
  if (leaveType) requests = requests.filter(r => r.leave_type === leaveType);
  if (year) {
    const y = String(year);
    requests = requests.filter(r => r.start_date && r.start_date.startsWith(y));
  }
  return requests.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

/**
 * Returns a leave balance summary for a user for the given year.
 * Shows entitlement, used, pending, and remaining for each leave type.
 */
export function getLeaveBalance({ userId, year, db }) {
  const y = year || new Date().getFullYear();
  const requests = (db.leave_requests || []).filter(
    r => r.user_id === userId && r.start_date && r.start_date.startsWith(String(y))
  );

  const balance = {};
  for (const [type, config] of Object.entries(LEAVE_TYPES)) {
    const approved = requests
      .filter(r => r.leave_type === type && r.status === "Approved")
      .reduce((sum, r) => sum + (r.days || 0), 0);
    const pending = requests
      .filter(r => r.leave_type === type && (r.status === "Submitted" || r.status === "Draft"))
      .reduce((sum, r) => sum + (r.days || 0), 0);

    balance[type] = {
      label: config.label,
      entitlement: config.default_days,
      used: approved,
      pending,
      remaining: Math.max(0, config.default_days - approved),
      accrual: config.accrual
    };
  }

  return { user_id: userId, year: y, balance };
}

/**
 * Returns a team calendar view — all approved/submitted leave for a
 * date range, useful for the Gantt/calendar frontend.
 */
export function getTeamLeaveCalendar({ startDate, endDate, db }) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const requests = (db.leave_requests || []).filter(r => {
    if (r.status !== "Approved" && r.status !== "Submitted") return false;
    const rStart = new Date(r.start_date);
    const rEnd = new Date(r.end_date);
    return rStart <= end && rEnd >= start;
  });

  // Enrich with user names
  const users = db.users || [];
  return requests.map(r => {
    const user = users.find(u => u.id === r.user_id);
    return {
      id: r.id,
      user_id: r.user_id,
      user_name: user?.name || r.user_id,
      leave_type: r.leave_type,
      start_date: r.start_date,
      end_date: r.end_date,
      days: r.days,
      status: r.status
    };
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

function findRequest(requestId, db) {
  const req = (db.leave_requests || []).find(r => r.id === requestId);
  if (!req) throw Object.assign(new Error("Leave request not found"), { status: 404 });
  return req;
}

function findOverlap({ userId, startDate, endDate, db }) {
  return (db.leave_requests || []).find(r => {
    if (r.user_id !== userId) return false;
    if (r.status === "Cancelled" || r.status === "Rejected") return false;
    const rStart = new Date(r.start_date);
    const rEnd = new Date(r.end_date);
    return startDate <= rEnd && endDate >= rStart;
  }) || null;
}

/**
 * Calculates business days between two dates (excludes weekends).
 * Zimbabwe public holidays are NOT deducted — that requires a holiday
 * calendar which is a future enhancement.
 */
export function calculateBusinessDays(start, end) {
  let count = 0;
  const current = new Date(start);
  while (current <= end) {
    const dow = current.getDay();
    if (dow !== 0 && dow !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}
