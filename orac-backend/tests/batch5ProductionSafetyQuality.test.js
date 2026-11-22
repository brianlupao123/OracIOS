import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  recordPreDispatchPpe,
  listPpeChecklists,
  createToolboxTalk,
  reportIncident,
  listIncidents
} from "../src/controllers/hseController.js";
import {
  postCreateJsa,
  postSubmitJsa,
  postApproveJsa,
  postCreateInspection,
  postRecordResults,
  postSubmitInspection,
  postSignOff
} from "../src/controllers/hseQualityController.js";
import { roles } from "../src/permissions.js";

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
      { id: "u_sup", role: roles.SUPERVISOR, name: "Simon Supervisor", is_active: true },
      { id: "u_hse", role: "HSE & Quality", name: "Helen HSE", is_active: true },
      { id: "u_tech_1", role: roles.TECHNICIAN, name: "Tom Tech", is_active: true },
      { id: "u_tech_2", role: roles.TECHNICIAN, name: "Tina Tech", is_active: true }
    ],
    pre_dispatch_ppe_checklists: [],
    toolbox_talks: [],
    hse_incident_reports: [],
    jsa_records: [],
    quality_inspections: [],
    dispatch_cards: [
      {
        id: "dc_job_1",
        dispatch_number: "JOB-2026-001",
        quotation_id: "q_1",
        purchase_order_id: "po_client_1",
        assigned_supervisor_id: "u_sup",
        assigned_technician_ids: ["u_tech_1"],
        status: "In_Progress"
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

test("Batch 5: Pre-Dispatch PPE Gate (S-11) — fail-closed blocking & complete pass", () => {
  const db = makeMockDb();

  // 1. Incomplete PPE checklist (metatarsal boots missing) is refused and blocks dispatch
  const reqIncomplete = {
    body: {
      dispatch_card_id: "dc_job_1",
      technician_id: "u_tech_1",
      technician_name: "Tom Tech",
      site_location: "Mimosa Concentrator",
      hard_hat_pass: true,
      metatarsal_boots_pass: false, // FAILED
      heavy_chemical_gloves_pass: true,
      safety_glasses_pass: true,
      high_vis_vest_pass: true,
      respirator_mask_pass: true,
      ear_protection_pass: true,
      fall_arrest_harness_pass: true
    },
    user: { id: "u_sup", role: roles.SUPERVISOR, name: "Simon Supervisor" },
    db,
    store: mockStore
  };
  const resIncomplete = mockRes();
  recordPreDispatchPpe(reqIncomplete, resIncomplete);
  assert.equal(resIncomplete.statusCode, 400);
  assert.equal(resIncomplete.body.code, "PPE_INSPECTION_FAILED");
  assert.equal(resIncomplete.body.data.status, "FAILED_BLOCKED");

  // 2. 100% compliant PPE checklist passes
  const reqCompliant = {
    body: {
      dispatch_card_id: "dc_job_1",
      technician_id: "u_tech_1",
      technician_name: "Tom Tech",
      site_location: "Mimosa Concentrator",
      hard_hat_pass: true,
      metatarsal_boots_pass: true,
      heavy_chemical_gloves_pass: true,
      safety_glasses_pass: true,
      high_vis_vest_pass: true,
      respirator_mask_pass: true,
      ear_protection_pass: true,
      fall_arrest_harness_pass: true
    },
    user: { id: "u_sup", role: roles.SUPERVISOR, name: "Simon Supervisor" },
    db,
    store: mockStore
  };
  const resCompliant = mockRes();
  recordPreDispatchPpe(reqCompliant, resCompliant);
  assert.equal(resCompliant.statusCode, 201);
  assert.equal(resCompliant.body.success, true);
  assert.equal(resCompliant.body.data.status, "PASSED");
  assert.equal(resCompliant.body.data.all_items_passed, true);
});

test("Batch 5: Clean UI Defaults in HseCompliancePage.jsx", () => {
  const pagePath = path.resolve(__dirname, "../../orac-ios-frontend/src/pages/HseCompliancePage.jsx");
  assert.ok(fs.existsSync(pagePath));
  const content = fs.readFileSync(pagePath, "utf8");

  // All 8 PPE checkboxes must initialize to false (Unassessed)
  assert.match(content, /hard_hat_pass:\s*false/);
  assert.match(content, /metatarsal_boots_pass:\s*false/);
  assert.match(content, /heavy_chemical_gloves_pass:\s*false/);
  assert.match(content, /safety_glasses_pass:\s*false/);
  assert.match(content, /high_vis_vest_pass:\s*false/);
  assert.match(content, /respirator_mask_pass:\s*false/);
  assert.match(content, /ear_protection_pass:\s*false/);
  assert.match(content, /fall_arrest_harness_pass:\s*false/);

  // Blank initial form state
  assert.match(content, /dispatch_card_id:\s*""/);
  assert.match(content, /site_location:\s*""/);
  assert.match(content, /topic:\s*""/);
  assert.match(content, /attendeesText:\s*""/);
  assert.match(content, /description:\s*""/);

  // No fake sample defaults
  assert.equal(content.includes('|| "u-tech-01"'), false);
  assert.equal(content.includes("Brian Lupao, Tendai Moyo"), false);
  assert.equal(content.includes("Artisan authorized for field dispatch"), false);
});

test("Batch 5: JSA Risk Assessment — authentication, RBAC & self-approval prevention", () => {
  const db = makeMockDb();

  // 1. Unauthenticated request to create JSA is refused with 401
  const reqUnauth = {
    body: {
      dispatchId: "dc_job_1",
      jobDescription: "Ball mill rubber lining",
      hazardSteps: [{ workStep: "Step 1", hazard: "Dust", likelihood: "Possible", severity: "Moderate" }]
    },
    user: null,
    db
  };
  const resUnauth = mockRes();
  postCreateJsa(reqUnauth, resUnauth);
  assert.equal(resUnauth.statusCode, 401);

  // 2. Technician creates JSA in Draft
  const reqCreate = {
    body: {
      dispatchId: "dc_job_1",
      jobDescription: "Ball mill rubber lining",
      hazardSteps: [
        { workStep: "Chute entry", hazard: "Confined space", likelihood: "Possible", severity: "Major", controlMeasures: ["Ventilation"] }
      ]
    },
    user: { id: "u_tech_1", role: roles.TECHNICIAN },
    db,
    store: mockStore
  };
  const resCreate = mockRes();
  postCreateJsa(reqCreate, resCreate);
  assert.equal(resCreate.statusCode, 201);
  const jsaId = resCreate.body.jsa.id;
  assert.equal(resCreate.body.jsa.assessed_by, "u_tech_1");
  assert.equal(resCreate.body.jsa.status, "Draft");

  // 3. Submitting JSA
  const reqSubmit = {
    params: { id: jsaId },
    user: { id: "u_tech_1", role: roles.TECHNICIAN },
    db,
    store: mockStore
  };
  const resSubmit = mockRes();
  postSubmitJsa(reqSubmit, resSubmit);
  assert.equal(resSubmit.statusCode, 200);
  assert.equal(resSubmit.body.jsa.status, "Submitted");

  // 4. Self-approval blocked (u_tech_1 cannot approve own JSA)
  const reqSelfApprove = {
    params: { id: jsaId },
    user: { id: "u_tech_1", role: "Supervisor" }, // even if acting with supervisor role
    db,
    store: mockStore
  };
  const resSelfApprove = mockRes();
  postApproveJsa(reqSelfApprove, resSelfApprove);
  assert.equal(resSelfApprove.statusCode, 403);
  assert.match(resSelfApprove.body.error, /Self-approval of JSA is not allowed/i);

  // 5. Independent Supervisor or HSE Officer approves
  const reqHseApprove = {
    params: { id: jsaId },
    user: { id: "u_hse", role: "HSE & Quality" },
    db,
    store: mockStore
  };
  const resHseApprove = mockRes();
  postApproveJsa(reqHseApprove, resHseApprove);
  assert.equal(resHseApprove.statusCode, 200);
  assert.equal(resHseApprove.body.jsa.status, "Approved");
  assert.equal(resHseApprove.body.jsa.approved_by, "u_hse");
});

test("Batch 5: Quality Inspection — critical item failure cannot be diluted & self sign-off blocked", () => {
  const db = makeMockDb();

  // 1. Create inspection with 5 items, one of which is critical
  const reqCreateInsp = {
    body: {
      dispatchId: "dc_job_1",
      inspectionType: "final",
      checklistItems: [
        { description: "Visual surface check", is_critical: false },
        { description: "Spark testing / pinhole holiday check", is_critical: true },
        { description: "Edge bevel angle check", is_critical: false },
        { description: "Hardness durometer Shore A test", is_critical: false },
        { description: "Cleanliness check", is_critical: false }
      ]
    },
    user: { id: "u_tech_1", role: roles.TECHNICIAN },
    db,
    store: mockStore
  };
  const resCreateInsp = mockRes();
  postCreateInspection(reqCreateInsp, resCreateInsp);
  assert.equal(resCreateInsp.statusCode, 201);
  const inspId = resCreateInsp.body.inspection.id;

  // 2. Record results: 4 items pass, but the critical holiday check fails (1/5 = 20% fail rate)
  const reqResults = {
    params: { id: inspId },
    body: {
      results: [
        { itemNumber: 1, result: "pass" },
        { itemNumber: 2, result: "fail", notes: "Pinholes detected at splice joint" },
        { itemNumber: 3, result: "pass" },
        { itemNumber: 4, result: "pass" },
        { itemNumber: 5, result: "pass" }
      ]
    },
    user: { id: "u_tech_1", role: roles.TECHNICIAN },
    db,
    store: mockStore
  };
  const resResults = mockRes();
  postRecordResults(reqResults, resResults);
  assert.equal(resResults.statusCode, 200);

  // 3. Submit inspection: Critical item failure MUST trigger Fail, NOT Conditional!
  const reqSubmitInsp = {
    params: { id: inspId },
    user: { id: "u_tech_1", role: roles.TECHNICIAN },
    db,
    store: mockStore
  };
  const resSubmitInsp = mockRes();
  postSubmitInspection(reqSubmitInsp, resSubmitInsp);
  assert.equal(resSubmitInsp.statusCode, 200);
  assert.equal(
    resSubmitInsp.body.inspection.verdict,
    "Fail",
    "Critical inspection failure must evaluate to Fail, preventing dilution by passing items"
  );

  // 4. Inspector self sign-off blocked
  const reqSelfSignOff = {
    params: { id: inspId },
    user: { id: "u_tech_1", role: "HSE & Quality" },
    db,
    store: mockStore
  };
  const resSelfSignOff = mockRes();
  postSignOff(reqSelfSignOff, resSelfSignOff);
  assert.equal(resSelfSignOff.statusCode, 403);
  assert.match(resSelfSignOff.body.error, /Cannot sign off your own inspection submission/i);

  // 5. Independent QA Officer signs off
  const reqQaSignOff = {
    params: { id: inspId },
    user: { id: "u_hse", role: "HSE & Quality" },
    db,
    store: mockStore
  };
  const resQaSignOff = mockRes();
  postSignOff(reqQaSignOff, resQaSignOff);
  assert.equal(resQaSignOff.statusCode, 200);
  assert.equal(resQaSignOff.body.inspection.status, "Signed_Off");
  assert.equal(resQaSignOff.body.inspection.signed_off_by, "u_hse");
});

test("Batch 5: HSE Incident Scoping — Technician sees only own reports; elevated sees all", () => {
  const db = makeMockDb();

  // 1. Technician 1 reports an incident
  const reqReport1 = {
    body: {
      incident_date: "2026-11-22",
      site_location: "Mimosa Shaft 1",
      severity: "NEAR_MISS",
      description: "Minor solvent drip onto floor",
      immediate_action_taken: "Wiped with spill kit"
    },
    user: { id: "u_tech_1", role: roles.TECHNICIAN, name: "Tom Tech" },
    db,
    store: mockStore
  };
  const resReport1 = mockRes();
  reportIncident(reqReport1, resReport1);
  assert.equal(resReport1.statusCode, 201);

  // 2. Technician 2 reports another incident
  const reqReport2 = {
    body: {
      incident_date: "2026-11-22",
      site_location: "Zimplats SMC",
      severity: "FIRST_AID",
      description: "Glove tear on sharp chute edge",
      immediate_action_taken: "Replaced glove, first aid plaster"
    },
    user: { id: "u_tech_2", role: roles.TECHNICIAN, name: "Tina Tech" },
    db,
    store: mockStore
  };
  const resReport2 = mockRes();
  reportIncident(reqReport2, resReport2);
  assert.equal(resReport2.statusCode, 201);

  // 3. Technician 1 lists incidents: only sees their own report
  const reqListTech1 = {
    user: { id: "u_tech_1", role: roles.TECHNICIAN },
    db
  };
  const resListTech1 = mockRes();
  listIncidents(reqListTech1, resListTech1);
  assert.equal(resListTech1.statusCode, 200);
  assert.equal(resListTech1.body.data.length, 1);
  assert.equal(resListTech1.body.data[0].reported_by, "u_tech_1");

  // 4. HSE & Quality lists incidents: sees both reports
  const reqListHse = {
    user: { id: "u_hse", role: "HSE & Quality" },
    db
  };
  const resListHse = mockRes();
  listIncidents(reqListHse, resListHse);
  assert.equal(resListHse.statusCode, 200);
  assert.equal(resListHse.body.data.length, 2);
});
