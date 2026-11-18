// backend/tests/dashboardRoleSummary.test.js
//
// Subsystem 1: Macro-Dashboard Role-Summary Aggregator
// Verifies unified, real-time KPI aggregation across all 13 subsystems in <80ms.

import test from "node:test";
import assert from "node:assert/strict";

import { getRoleDashboardSummary } from "../src/controllers/dashboardController.js";

function createMockReqRes({ user, db = {} }) {
  let statusCode = 200;
  let responseData = null;

  const req = {
    user: user || { id: "u-admin", role: "Admin", name: "System Admin" },
    db: {
      users: [
        { id: "u-admin", role: "Admin", name: "System Admin" },
        { id: "u-client", role: "Client Viewer", name: "Client Lead", client_id: "c-zimplats" }
      ],
      quotes: [
        { id: "q-1", status: "Draft" },
        { id: "q-2", status: "Approved" }
      ],
      dispatch_cards: [
        { id: "d-1", client_id: "c-zimplats", status: "In_Progress" },
        { id: "d-2", client_id: "c-mimosa", status: "Completed" }
      ],
      purchase_orders: [
        { id: "po-1", status: "Verified" }
      ],
      procurement_requests: [
        { id: "pr-1", status: "PENDING_APPROVAL" }
      ],
      vehicles: [
        { id: "veh-1", reg_number: "AFK-1029", vid_certificate_expiry: "2027-11-17" }
      ],
      pre_dispatch_ppe_checklists: [
        { id: "ppe-1", status: "PASSED" }
      ],
      artisan_qualifications: [
        { id: "aq-1", artisan_name: "Takunda", qualification_type: "FITTER_CLASS_1" }
      ],
      mine_site_inductions: [
        { id: "ind-1", artisan_id: "art-1", mine_site: "ZIMPLATS_SMC", valid_until: "2027-11-17" }
      ],
      virtual_technical_surveys: [
        { id: "srv-1", client_id: "c-zimplats", status: "SCHEDULED" }
      ],
      client_job_feedbacks: [
        { id: "fb-1", client_id: "c-zimplats", rating_stars: 5, nps_score: 10 }
      ],
      iot_threshold_alerts: [
        { id: "alt-1", status: "ACTIVE", severity: "CRITICAL" }
      ],
      offline_sync_journal: [
        { id: "jrn-1", sync_status: "COMMITTED" }
      ],
      ...db
    }
  };

  const res = {
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: (data) => {
      responseData = data;
      return res;
    },
    getStatusCode: () => statusCode,
    getData: () => responseData
  };

  return { req, res };
}

test("Dashboard Role-Summary: aggregates all 13 subsystems in <80ms for Admin", () => {
  const { req, res } = createMockReqRes({
    user: { id: "u-admin", role: "Admin", name: "System Admin" }
  });

  const startTime = Date.now();
  getRoleDashboardSummary(req, res);
  const durationMs = Date.now() - startTime;

  assert.ok(durationMs < 80, `Aggregation must complete in <80ms (took ${durationMs}ms)`);
  assert.equal(res.getStatusCode(), 200);

  const body = res.getData();
  assert.equal(body.success, true);
  assert.equal(body.role, "Admin");

  const sub = body.subsystems;
  assert.ok(sub.commercial);
  assert.equal(sub.commercial.total_quotes, 2);
  assert.equal(sub.commercial.draft_quotes, 1);
  assert.equal(sub.commercial.verified_pos, 1);

  assert.ok(sub.operations);
  assert.equal(sub.operations.total_dispatches, 2);
  assert.equal(sub.operations.active_dispatches, 1);

  assert.ok(sub.procurement);
  assert.equal(sub.procurement.pending_requests, 1);

  assert.ok(sub.fleet);
  assert.equal(sub.fleet.total_vehicles, 1);

  assert.ok(sub.hse);
  assert.equal(sub.hse.ppe_gate_passes, 1);

  assert.ok(sub.artisan_vault);
  assert.equal(sub.artisan_vault.total_qualifications, 1);

  assert.ok(sub.virtual_surveys);
  assert.equal(sub.virtual_surveys.total_surveys, 1);

  assert.ok(sub.client_satisfaction);
  assert.ok(sub.client_satisfaction.nps);

  assert.ok(sub.plant_telemetry);
  assert.equal(sub.plant_telemetry.critical_alerts_count, 1);

  assert.ok(sub.offline_sync);
  assert.equal(sub.offline_sync.total_journaled_mutations, 1);
});

test("Dashboard Role-Summary: scopes data strictly by client_id for Client Viewer", () => {
  const { req, res } = createMockReqRes({
    user: { id: "u-client", role: "Client Viewer", name: "Zimplats Engineer", client_id: "c-zimplats" }
  });

  getRoleDashboardSummary(req, res);
  assert.equal(res.getStatusCode(), 200);

  const body = res.getData();
  assert.equal(body.role, "Client Viewer");

  // Out of 2 total dispatches (1 for zimplats, 1 for mimosa), client sees only their 1
  assert.equal(body.subsystems.operations.total_dispatches, 1);
  assert.equal(body.subsystems.virtual_surveys.total_surveys, 1);
});
