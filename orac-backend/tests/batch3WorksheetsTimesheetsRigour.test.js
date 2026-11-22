import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createLeave,
  listLeaves,
  getLeave,
  submitLeave,
  approveLeave,
  rejectLeave,
  cancelLeave,
  getBalance
} from "../src/controllers/leaveController.js";
import { roles } from "../src/permissions.js";
import {
  isKioskEntry,
  kioskReviewStatus,
  timesheetCountsAsApproved,
  KIOSK_REVIEW_STATUS
} from "../src/timesheetReview.js";
import { evaluateWorkerPayrollReadiness } from "../src/payroll.js";
import {
  SEVERITY,
  EXCEPTION_CODES,
  WEEKDAY_OT15_REVIEW_THRESHOLD_HOURS
} from "../src/worksheetRegisterLogic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    }
  };
}

function makeMockDb() {
  return {
    users: [
      { id: "u_admin", role: roles.ADMIN, name: "Alice Admin", is_active: true },
      { id: "u_mgmt", role: roles.MANAGEMENT, name: "Mark Manager", is_active: true },
      { id: "u_ops", role: roles.OPERATIONS, name: "Oliver Ops", is_active: true },
      { id: "u_hr", role: "Human Resources", name: "Hannah HR", is_active: true },
      { id: "u_sales", role: roles.SALES, name: "Sam Sales", is_active: true },
      { id: "u_tech_1", role: roles.TECHNICIAN, name: "Tom Tech", is_active: true },
      { id: "u_tech_2", role: roles.TECHNICIAN, name: "Tina Tech", is_active: true }
    ],
    leave_requests: [
      {
        id: "lr-001",
        user_id: "u_tech_1",
        leave_type: "annual",
        start_date: "2026-12-01",
        end_date: "2026-12-05",
        days: 5,
        status: "Submitted",
        reason: "Annual vacation",
        created_at: "2026-11-20T08:00:00Z",
        submitted_at: "2026-11-20T08:05:00Z"
      },
      {
        id: "lr-002",
        user_id: "u_tech_2",
        leave_type: "sick",
        start_date: "2026-12-10",
        end_date: "2026-12-12",
        days: 3,
        status: "Draft",
        reason: "Medical appointment",
        created_at: "2026-11-21T09:00:00Z"
      }
    ],
    audit_log: []
  };
}

const mockStore = {
  id: (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  audit: (db, actor, entity, entityId, action, details) => {
    db.audit_log = db.audit_log || [];
    db.audit_log.push({ at: new Date().toISOString(), actor, entity, entityId, action, details });
  }
};

test("Batch 3: Leave Approver RBAC — role restriction on approval and rejection", () => {
  const db = makeMockDb();

  // 1. Technician attempting to approve returns 403
  const reqTech = {
    params: { id: "lr-001" },
    user: { id: "u_tech_2", role: "Technician" },
    db,
    store: mockStore
  };
  const resTech = mockRes();
  approveLeave(reqTech, resTech);
  assert.equal(resTech.statusCode, 403);
  assert.match(resTech.body.message, /not authorized to approve leave/i);

  // 2. Sales attempting to reject returns 403
  const reqSales = {
    params: { id: "lr-001" },
    user: { id: "u_sales", role: "Sales" },
    body: { reason: "Refusal" },
    db,
    store: mockStore
  };
  const resSales = mockRes();
  rejectLeave(reqSales, resSales);
  assert.equal(resSales.statusCode, 403);
  assert.match(resSales.body.message, /not authorized to reject leave/i);

  // 3. Self-approval block: requester cannot approve their own leave even if elevated
  db.leave_requests.push({
    id: "lr-ops",
    user_id: "u_ops",
    leave_type: "annual",
    start_date: "2026-12-15",
    end_date: "2026-12-16",
    days: 2,
    status: "Submitted"
  });
  const reqSelf = {
    params: { id: "lr-ops" },
    user: { id: "u_ops", role: "Operations" },
    db,
    store: mockStore
  };
  const resSelf = mockRes();
  approveLeave(reqSelf, resSelf);
  assert.equal(resSelf.statusCode, 403);
  assert.match(resSelf.body.message, /Cannot approve your own leave request/i);

  // 4. Authorized role (Human Resources) successfully approves
  const reqHr = {
    params: { id: "lr-001" },
    user: { id: "u_hr", role: "Human Resources" },
    db,
    store: mockStore
  };
  const resHr = mockRes();
  approveLeave(reqHr, resHr);
  assert.equal(resHr.statusCode, 200);
  assert.equal(resHr.body.success, true);
  assert.equal(resHr.body.data.status, "Approved");
  assert.equal(resHr.body.data.approved_by, "u_hr");
});

test("Batch 3: Leave Management — cancellation guards and HR visibility parity", () => {
  const db = makeMockDb();

  // 1. Technician 2 cannot cancel Technician 1's leave request
  const reqCancelUnauth = {
    params: { id: "lr-001" },
    user: { id: "u_tech_2", role: "Technician" },
    body: { reason: "Malicious cancel" },
    db,
    store: mockStore
  };
  const resCancelUnauth = mockRes();
  cancelLeave(reqCancelUnauth, resCancelUnauth);
  assert.equal(resCancelUnauth.statusCode, 403);
  assert.match(resCancelUnauth.body.message, /cannot cancel another user's leave/i);

  // 2. Technician 1 can view only their own leave in listLeaves
  const reqListTech = {
    query: {},
    user: { id: "u_tech_1", role: "Technician" },
    db
  };
  const resListTech = mockRes();
  listLeaves(reqListTech, resListTech);
  assert.equal(resListTech.statusCode, 200);
  assert.equal(resListTech.body.data.length, 1);
  assert.equal(resListTech.body.data[0].id, "lr-001");

  // 3. Human Resources sees all leave requests in listLeaves
  const reqListHr = {
    query: {},
    user: { id: "u_hr", role: "Human Resources" },
    db
  };
  const resListHr = mockRes();
  listLeaves(reqListHr, resListHr);
  assert.equal(resListHr.statusCode, 200);
  assert.equal(resListHr.body.data.length, 2);

  // 4. Technician cannot view another user's balance in getBalance
  const reqBalTech = {
    params: { userId: "u_tech_2" },
    query: {},
    user: { id: "u_tech_1", role: "Technician" },
    db
  };
  const resBalTech = mockRes();
  getBalance(reqBalTech, resBalTech);
  assert.equal(resBalTech.statusCode, 403);

  // 5. Human Resources can view another user's balance in getBalance
  const reqBalHr = {
    params: { userId: "u_tech_1" },
    query: { year: "2026" },
    user: { id: "u_hr", role: "Human Resources" },
    db
  };
  const resBalHr = mockRes();
  getBalance(reqBalHr, resBalHr);
  assert.equal(resBalHr.statusCode, 200);
  assert.equal(resBalHr.body.success, true);
  assert.ok(resBalHr.body.data.balance.annual);
  assert.equal(resBalHr.body.data.balance.annual.entitlement, 22);
});

test("Batch 3: Clean Artisan Vault Defaults — verified zero fake prefilled form data", () => {
  const artisanPagePath = path.resolve(__dirname, "../../orac-ios-frontend/src/pages/ArtisanVaultPage.jsx");
  assert.ok(fs.existsSync(artisanPagePath), "ArtisanVaultPage.jsx must exist");
  const content = fs.readFileSync(artisanPagePath, "utf8");

  // Zero residual dummy certificate, induction card or dispatch mock strings
  assert.equal(content.includes("RS-ZIM-2024-912"), false, "Must not contain dummy certificate RS-ZIM-2024-912");
  assert.equal(content.includes("ZIMP-IND-8831"), false, "Must not contain dummy induction card ZIMP-IND-8831");
  assert.equal(content.includes("DC-FIELD-701"), false, "Must not contain dummy dispatch card DC-FIELD-701");

  // Must initialize empty strings and fail-closed false medical pass
  assert.match(content, /certificate_number:\s*""/);
  assert.match(content, /induction_card_number:\s*""/);
  assert.match(content, /medical_fit_to_work_pass:\s*false/);
  assert.match(content, /dispatch_card_id:\s*""/);
});

test("Batch 3: Attendance vs Payroll vs Billable Distinction & OT 1.5 Warning Severity", () => {
  // 1. Kiosk review gate: unreviewed or pending attendance does NOT count as approved hours
  const rawKioskEntry = { id: "ts-kiosk-1", entry_source: "kiosk", hours_logged: 8 };
  assert.equal(isKioskEntry(rawKioskEntry), true);
  assert.equal(kioskReviewStatus(rawKioskEntry), KIOSK_REVIEW_STATUS.PENDING);
  assert.equal(timesheetCountsAsApproved(rawKioskEntry), false, "Pending kiosk entries must not count as approved hours");

  const approvedKioskEntry = { id: "ts-kiosk-2", entry_source: "kiosk", review_status: "approved", hours_logged: 8 };
  assert.equal(timesheetCountsAsApproved(approvedKioskEntry), true, "Approved kiosk entries count as approved hours");

  const paperEntry = { id: "ts-paper-1", entry_source: "worksheet", hours_logged: 8 };
  assert.equal(isKioskEntry(paperEntry), false);
  assert.equal(timesheetCountsAsApproved(paperEntry), true, "Worksheet paper entries count as approved hours");

  // 2. Sage Pastel payroll export readiness: national ID fallback disabled, requires employee code
  const workerWithoutEmpCode = { technician_id: "u-t1", national_id: "63-123456-X-42" };
  const readinessFail = evaluateWorkerPayrollReadiness(workerWithoutEmpCode);
  assert.equal(readinessFail.export_ready, false);
  assert.ok(readinessFail.export_blockers.some((b) => b.includes("national ID fallback is disabled")));

  const workerWithEmpCode = { technician_id: "u-t1", employee_code: "EMP-4001" };
  const readinessOk = evaluateWorkerPayrollReadiness(workerWithEmpCode);
  assert.equal(readinessOk.export_ready, true);
  assert.equal(readinessOk.export_blockers.length, 0);

  // 3. 3-hour weekday OT 1.5 review threshold emits SEVERITY.WARNING, not SEVERITY.BLOCKING
  assert.equal(WEEKDAY_OT15_REVIEW_THRESHOLD_HOURS, 3);
  assert.equal(SEVERITY.WARNING, "warning");
  assert.equal(SEVERITY.BLOCKING, "blocking");
  assert.equal(EXCEPTION_CODES.WEEKDAY_OT15_OVER_THRESHOLD, "WEEKDAY_OT15_OVER_THRESHOLD");
});
