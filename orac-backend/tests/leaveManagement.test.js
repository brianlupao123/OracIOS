// tests/leaveManagement.test.js — Leave & Absence Management
//
// Tests the leave service (state machine, balance, calendar, business days)
// and the controller handlers.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  LEAVE_TYPES, LEAVE_TYPE_KEYS, LEAVE_STATES,
  createLeaveRequest, submitLeaveRequest, approveLeaveRequest,
  rejectLeaveRequest, cancelLeaveRequest, getLeaveRequest,
  listLeaveRequests, getLeaveBalance, getTeamLeaveCalendar,
  calculateBusinessDays
} from "../src/services/leaveService.js";

import {
  createLeave, listLeaves, getLeave, submitLeave,
  approveLeave, rejectLeave, cancelLeave,
  getBalance, getCalendar, getLeaveTypes
} from "../src/controllers/leaveController.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeStore() {
  const auditLog = [];
  return {
    audit: (db, actor, collection, entityId, action, details) => {
      auditLog.push({ actor: actor?.id, collection, entityId, action, details });
    },
    _auditLog: auditLog
  };
}

function makeDb(overrides = {}) {
  return { leave_requests: [], users: [], ...overrides };
}

function makeReq(body = {}, db = null, params = {}, query = {}, user = null) {
  return {
    body,
    params,
    query,
    db: db || makeDb(),
    store: makeStore(),
    user: user || { id: "u-1", role: "Admin" }
  };
}

function makeRes() {
  const res = {
    _status: 200,
    _json: null,
    status(code) { res._status = code; return res; },
    json(data) { res._json = data; return res; }
  };
  return res;
}

// ═════════════════════════════════════════════════════════════════════
// Service: calculateBusinessDays
// ═════════════════════════════════════════════════════════════════════

describe("leaveService — calculateBusinessDays", () => {
  it("counts weekdays only (Mon-Fri)", () => {
    // Mon 2026-11-16 to Fri 2026-11-20 = 5 business days
    const days = calculateBusinessDays(new Date("2026-11-16"), new Date("2026-11-20"));
    assert.equal(days, 5);
  });

  it("excludes weekends", () => {
    // Mon 2026-11-16 to Sun 2026-11-22 = 5 business days (Mon-Fri)
    const days = calculateBusinessDays(new Date("2026-11-16"), new Date("2026-11-22"));
    assert.equal(days, 5);
  });

  it("single day is 1 business day if weekday", () => {
    const days = calculateBusinessDays(new Date("2026-11-16"), new Date("2026-11-16")); // Monday
    assert.equal(days, 1);
  });

  it("single Saturday is 0 business days", () => {
    const days = calculateBusinessDays(new Date("2026-11-21"), new Date("2026-11-21")); // Saturday
    assert.equal(days, 0);
  });

  it("two weeks = 10 business days", () => {
    const days = calculateBusinessDays(new Date("2026-11-16"), new Date("2026-11-29")); // Mon to Sun
    assert.equal(days, 10);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Service: Leave Types & States
// ═════════════════════════════════════════════════════════════════════

describe("leaveService — types and states", () => {
  it("defines 7 leave types", () => {
    assert.equal(LEAVE_TYPE_KEYS.length, 7);
  });

  it("includes Zimbabwe-required types", () => {
    assert.ok(LEAVE_TYPES.annual);
    assert.ok(LEAVE_TYPES.sick);
    assert.ok(LEAVE_TYPES.compassionate);
    assert.ok(LEAVE_TYPES.maternity);
  });

  it("annual leave has 22 days entitlement", () => {
    assert.equal(LEAVE_TYPES.annual.default_days, 22);
  });

  it("defines 5 leave states", () => {
    assert.equal(LEAVE_STATES.length, 5);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Service: CRUD
// ═════════════════════════════════════════════════════════════════════

describe("leaveService — createLeaveRequest", () => {
  it("creates a leave request in Draft state", () => {
    const db = makeDb();
    const store = makeStore();
    const req = createLeaveRequest({
      userId: "u-1", leaveType: "annual",
      startDate: "2026-11-30", endDate: "2026-12-04",
      reason: "Family holiday", store, db
    });

    assert.ok(req.id.startsWith("lv_"));
    assert.equal(req.status, "Draft");
    assert.equal(req.leave_type, "annual");
    assert.equal(req.days, 5); // Mon 30 Nov – Fri 4 Dec
    assert.equal(db.leave_requests.length, 1);
  });

  it("rejects invalid leave type", () => {
    const db = makeDb();
    const store = makeStore();
    assert.throws(
      () => createLeaveRequest({ userId: "u-1", leaveType: "sabbatical", startDate: "2026-12-01", endDate: "2026-12-05", store, db }),
      /Invalid leave type/
    );
  });

  it("rejects endDate before startDate", () => {
    const db = makeDb();
    const store = makeStore();
    assert.throws(
      () => createLeaveRequest({ userId: "u-1", leaveType: "annual", startDate: "2026-12-05", endDate: "2026-12-01", store, db }),
      /endDate/
    );
  });

  it("rejects sick leave > 2 days without medical cert", () => {
    const db = makeDb();
    const store = makeStore();
    assert.throws(
      () => createLeaveRequest({ userId: "u-1", leaveType: "sick", startDate: "2026-12-01", endDate: "2026-12-05", store, db }),
      /medical certificate/
    );
  });

  it("allows sick leave > 2 days WITH medical cert", () => {
    const db = makeDb();
    const store = makeStore();
    const req = createLeaveRequest({
      userId: "u-1", leaveType: "sick",
      startDate: "2026-12-01", endDate: "2026-12-05",
      medicalCertRef: "DR-MOYO-2026-1201", store, db
    });
    assert.equal(req.medical_cert_ref, "DR-MOYO-2026-1201");
  });

  it("allows sick leave <= 2 days without medical cert", () => {
    const db = makeDb();
    const store = makeStore();
    const req = createLeaveRequest({
      userId: "u-1", leaveType: "sick",
      startDate: "2026-12-01", endDate: "2026-12-02", // Mon-Tue = 2 days
      store, db
    });
    assert.equal(req.days, 2);
  });

  it("rejects overlapping dates with existing approved leave", () => {
    const db = makeDb();
    const store = makeStore();
    const first = createLeaveRequest({ userId: "u-1", leaveType: "annual", startDate: "2026-12-01", endDate: "2026-12-05", store, db });
    submitLeaveRequest({ requestId: first.id, userId: "u-1", store, db });
    approveLeaveRequest({ requestId: first.id, approvedBy: "u-mgr", store, db });

    assert.throws(
      () => createLeaveRequest({ userId: "u-1", leaveType: "annual", startDate: "2026-12-03", endDate: "2026-12-10", store, db }),
      /overlap/i
    );
  });

  it("allows non-overlapping dates", () => {
    const db = makeDb();
    const store = makeStore();
    createLeaveRequest({ userId: "u-1", leaveType: "annual", startDate: "2026-12-01", endDate: "2026-12-05", store, db });
    const second = createLeaveRequest({ userId: "u-1", leaveType: "annual", startDate: "2026-12-08", endDate: "2026-12-12", store, db });
    assert.ok(second.id);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Service: State Machine
// ═════════════════════════════════════════════════════════════════════

describe("leaveService — state machine", () => {
  it("happy path: Draft → Submitted → Approved", () => {
    const db = makeDb();
    const store = makeStore();
    const req = createLeaveRequest({ userId: "u-1", leaveType: "annual", startDate: "2026-12-01", endDate: "2026-12-05", store, db });

    submitLeaveRequest({ requestId: req.id, userId: "u-1", store, db });
    assert.equal(req.status, "Submitted");

    approveLeaveRequest({ requestId: req.id, approvedBy: "u-mgr", store, db });
    assert.equal(req.status, "Approved");
    assert.equal(req.approved_by, "u-mgr");
  });

  it("blocks self-approval", () => {
    const db = makeDb();
    const store = makeStore();
    const req = createLeaveRequest({ userId: "u-1", leaveType: "annual", startDate: "2026-12-01", endDate: "2026-12-05", store, db });
    submitLeaveRequest({ requestId: req.id, userId: "u-1", store, db });

    assert.throws(
      () => approveLeaveRequest({ requestId: req.id, approvedBy: "u-1", store, db }),
      /own leave/i
    );
  });

  it("blocks self-rejection", () => {
    const db = makeDb();
    const store = makeStore();
    const req = createLeaveRequest({ userId: "u-1", leaveType: "annual", startDate: "2026-12-01", endDate: "2026-12-05", store, db });
    submitLeaveRequest({ requestId: req.id, userId: "u-1", store, db });

    assert.throws(
      () => rejectLeaveRequest({ requestId: req.id, rejectedBy: "u-1", store, db }),
      /own leave/i
    );
  });

  it("rejection with reason", () => {
    const db = makeDb();
    const store = makeStore();
    const req = createLeaveRequest({ userId: "u-1", leaveType: "annual", startDate: "2026-12-01", endDate: "2026-12-05", store, db });
    submitLeaveRequest({ requestId: req.id, userId: "u-1", store, db });
    rejectLeaveRequest({ requestId: req.id, rejectedBy: "u-mgr", reason: "Critical project deadline", store, db });

    assert.equal(req.status, "Rejected");
    assert.equal(req.rejection_reason, "Critical project deadline");
  });

  it("cancellation of approved leave", () => {
    const db = makeDb();
    const store = makeStore();
    const req = createLeaveRequest({ userId: "u-1", leaveType: "annual", startDate: "2026-12-01", endDate: "2026-12-05", store, db });
    submitLeaveRequest({ requestId: req.id, userId: "u-1", store, db });
    approveLeaveRequest({ requestId: req.id, approvedBy: "u-mgr", store, db });
    cancelLeaveRequest({ requestId: req.id, cancelledBy: "u-1", reason: "Plans changed", store, db });

    assert.equal(req.status, "Cancelled");
  });

  it("rejects invalid transition", () => {
    const db = makeDb();
    const store = makeStore();
    const req = createLeaveRequest({ userId: "u-1", leaveType: "annual", startDate: "2026-12-01", endDate: "2026-12-05", store, db });
    submitLeaveRequest({ requestId: req.id, userId: "u-1", store, db });
    rejectLeaveRequest({ requestId: req.id, rejectedBy: "u-mgr", store, db });

    // Can't approve after rejection
    assert.throws(
      () => approveLeaveRequest({ requestId: req.id, approvedBy: "u-mgr", store, db }),
      /Invalid leave transition/
    );
  });

  it("only requester can submit", () => {
    const db = makeDb();
    const store = makeStore();
    const req = createLeaveRequest({ userId: "u-1", leaveType: "annual", startDate: "2026-12-01", endDate: "2026-12-05", store, db });

    assert.throws(
      () => submitLeaveRequest({ requestId: req.id, userId: "u-other", store, db }),
      /only the requester/i
    );
  });
});

// ═════════════════════════════════════════════════════════════════════
// Service: Leave Balance
// ═════════════════════════════════════════════════════════════════════

describe("leaveService — getLeaveBalance", () => {
  it("returns balance with used and remaining", () => {
    const db = makeDb();
    const store = makeStore();

    // Create and approve 5 days annual leave (Mon 30 Nov – Fri 4 Dec)
    const req = createLeaveRequest({ userId: "u-1", leaveType: "annual", startDate: "2026-11-30", endDate: "2026-12-04", store, db });
    submitLeaveRequest({ requestId: req.id, userId: "u-1", store, db });
    approveLeaveRequest({ requestId: req.id, approvedBy: "u-mgr", store, db });

    const balance = getLeaveBalance({ userId: "u-1", year: 2026, db });
    assert.equal(balance.balance.annual.entitlement, 22);
    assert.equal(balance.balance.annual.used, 5);
    assert.equal(balance.balance.annual.remaining, 17);
  });

  it("tracks pending leave separately", () => {
    const db = makeDb();
    const store = makeStore();

    const req = createLeaveRequest({ userId: "u-1", leaveType: "annual", startDate: "2026-12-07", endDate: "2026-12-11", store, db });
    submitLeaveRequest({ requestId: req.id, userId: "u-1", store, db });
    // Not yet approved

    const balance = getLeaveBalance({ userId: "u-1", year: 2026, db });
    assert.equal(balance.balance.annual.pending, 5);
    assert.equal(balance.balance.annual.used, 0);
  });

  it("returns all leave types in balance", () => {
    const db = makeDb();
    const balance = getLeaveBalance({ userId: "u-1", year: 2026, db });
    assert.equal(Object.keys(balance.balance).length, 7);
    assert.ok(balance.balance.annual);
    assert.ok(balance.balance.sick);
    assert.ok(balance.balance.maternity);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Service: Team Calendar
// ═════════════════════════════════════════════════════════════════════

describe("leaveService — getTeamLeaveCalendar", () => {
  it("returns approved/submitted leave in date range", () => {
    const db = makeDb({
      leave_requests: [
        { id: "lv-1", user_id: "u-1", leave_type: "annual", start_date: "2026-12-01", end_date: "2026-12-05", days: 5, status: "Approved" },
        { id: "lv-2", user_id: "u-2", leave_type: "sick", start_date: "2026-12-10", end_date: "2026-12-11", days: 2, status: "Submitted" },
        { id: "lv-3", user_id: "u-3", leave_type: "annual", start_date: "2026-12-20", end_date: "2026-12-24", days: 5, status: "Rejected" }
      ],
      users: [
        { id: "u-1", name: "Brian" },
        { id: "u-2", name: "Sam" }
      ]
    });

    const calendar = getTeamLeaveCalendar({ startDate: "2026-12-01", endDate: "2026-12-15", db });
    assert.equal(calendar.length, 2); // lv-1 and lv-2 (lv-3 is rejected, out of range)
    assert.equal(calendar[0].user_name, "Brian");
  });

  it("excludes leave outside date range", () => {
    const db = makeDb({
      leave_requests: [
        { id: "lv-1", user_id: "u-1", leave_type: "annual", start_date: "2026-11-01", end_date: "2026-11-05", days: 5, status: "Approved" }
      ]
    });

    const calendar = getTeamLeaveCalendar({ startDate: "2026-12-01", endDate: "2026-12-31", db });
    assert.equal(calendar.length, 0);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Controller handlers
// ═════════════════════════════════════════════════════════════════════

describe("leaveController — handlers", () => {
  it("POST /leave-requests creates leave request", () => {
    const db = makeDb();
    const req = makeReq({ leave_type: "annual", start_date: "2026-12-01", end_date: "2026-12-05" }, db);
    const res = makeRes();

    createLeave(req, res);
    assert.equal(res._status, 201);
    assert.equal(res._json.success, true);
    assert.ok(res._json.data.id.startsWith("lv_"));
  });

  it("POST /leave-requests rejects invalid type", () => {
    const db = makeDb();
    const req = makeReq({ leave_type: "sabbatical", start_date: "2026-12-01", end_date: "2026-12-05" }, db);
    const res = makeRes();

    createLeave(req, res);
    assert.equal(res._status, 400);
  });

  it("GET /leave-types returns all types", () => {
    const req = makeReq();
    const res = makeRes();

    getLeaveTypes(req, res);
    assert.equal(res._json.success, true);
    assert.ok(res._json.data.annual);
  });

  it("GET /leave-balance/:userId returns balance", () => {
    const db = makeDb();
    const req = makeReq({}, db, { userId: "u-1" }, { year: "2026" });
    const res = makeRes();

    getBalance(req, res);
    assert.equal(res._json.success, true);
    assert.equal(res._json.data.year, 2026);
  });

  it("GET /leave-balance blocks non-admin viewing other's balance", () => {
    const db = makeDb();
    const req = makeReq({}, db, { userId: "u-other" }, {}, { id: "u-1", role: "Technician" });
    const res = makeRes();

    getBalance(req, res);
    assert.equal(res._status, 403);
  });

  it("GET /leave-calendar returns calendar data", () => {
    const db = makeDb({
      leave_requests: [
        { id: "lv-1", user_id: "u-1", leave_type: "annual", start_date: "2026-12-01", end_date: "2026-12-05", days: 5, status: "Approved" }
      ],
      users: [{ id: "u-1", name: "Brian" }]
    });
    const req = makeReq({}, db, {}, { start_date: "2026-12-01", end_date: "2026-12-31" });
    const res = makeRes();

    getCalendar(req, res);
    assert.equal(res._json.success, true);
    assert.equal(res._json.data.length, 1);
  });
});
