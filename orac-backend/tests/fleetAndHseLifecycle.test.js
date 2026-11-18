import test from "node:test";
import assert from "node:assert/strict";

import {
  createVehicle,
  listVehicles,
  dispatchVehicle,
  returnVehicle,
  logFuel,
  getFleetSummary
} from "../src/controllers/fleetController.js";

import {
  recordPreDispatchPpe,
  listPpeChecklists,
  createToolboxTalk,
  listToolboxTalks,
  reportIncident,
  listIncidents,
  getHseSummary
} from "../src/controllers/hseController.js";

function res() {
  return {
    statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; }
  };
}

const ROLES = ["Admin", "Management", "Operations", "Finance", "Supervisor", "Technician", "Client Viewer"];

function createTestWorld() {
  let counter = 0;
  const users = ROLES.map(role => ({
    id: `u-${role.toLowerCase()}`,
    role,
    name: `${role} User`,
    is_active: true
  }));

  const db = {
    users,
    vehicles: [],
    vehicle_dispatches: [],
    vehicle_fuel_logs: [],
    pre_dispatch_ppe_checklists: [],
    toolbox_talks: [],
    hse_incident_reports: [],
    audit_logs: []
  };

  const store = {
    id: (prefix) => `${prefix}-${++counter}`,
    audit: (dbRef, actor, entityType, entityId, action, before, after) => {
      dbRef.audit_logs.push({
        id: `aud-${++counter}`,
        actor_id: actor?.id || "u-sys",
        entity_type: entityType,
        entity_id: entityId,
        action,
        timestamp: new Date().toISOString()
      });
    }
  };

  return { db, store };
}

const as = (w, role, req = {}) => ({
  user: { id: `u-${role.toLowerCase()}` },
  db: w.db,
  store: w.store,
  params: req.params || {},
  body: req.body || {},
  query: req.query || {}
});

// ── 1. Fleet Lifecycle & Odometer Tracking ──────────────────────────────────

test("fleet management: vehicle registration -> dispatch -> return -> fuel log", () => {
  const w = createTestWorld();

  // 1. Register vehicle with valid VID
  const rVeh = res();
  createVehicle(as(w, "Operations", {
    body: {
      plate_number: "AFG-1029",
      make: "Toyota",
      model: "Land Cruiser 4x4",
      year: 2024,
      vehicle_type: "4X4_FIELD_BAKKIE",
      current_odometer_km: 15400.0,
      vid_certificate_number: "VID-2026-8812",
      vid_expiry_date: "2027-12-31",
      insurance_expiry_date: "2027-12-31"
    }
  }), rVeh);

  assert.equal(rVeh.statusCode, 201);
  assert.equal(rVeh.body.success, true);
  const vehicle = rVeh.body.data;
  assert.equal(vehicle.plate_number, "AFG-1029");
  assert.equal(vehicle.status, "AVAILABLE");

  // 2. Dispatch vehicle for site job
  const rDisp = res();
  dispatchVehicle(as(w, "Supervisor", {
    body: {
      vehicle_id: vehicle.id,
      dispatch_card_id: "dc-77",
      driver_id: "u-technician",
      driver_name: "Technician User",
      destination: "Zimplats Selous SMC Concentrator",
      purpose: "Slurry pump ceramic lining installation",
      departure_odometer_km: 15400.0
    }
  }), rDisp);

  assert.equal(rDisp.statusCode, 201);
  assert.equal(rDisp.body.success, true);
  const trip = rDisp.body.data;
  assert.equal(trip.status, "ACTIVE");
  assert.equal(vehicle.status, "DISPATCHED");

  // 3. Return vehicle with completed trip distance
  const rRet = res();
  returnVehicle(as(w, "Supervisor", {
    params: { id: trip.id },
    body: {
      return_odometer_km: 15680.0,
      return_notes: "Trip completed safely. No defects noted."
    }
  }), rRet);

  assert.equal(rRet.statusCode, 200);
  assert.equal(rRet.body.success, true);
  assert.equal(rRet.body.data.status, "COMPLETED");
  assert.equal(rRet.body.data.distance_travelled_km, 280.0);
  assert.equal(vehicle.status, "AVAILABLE");
  assert.equal(vehicle.current_odometer_km, 15680.0);

  // 4. Log fuel voucher
  const rFuel = res();
  logFuel(as(w, "Finance", {
    body: {
      vehicle_id: vehicle.id,
      voucher_number: "PUMA-FUEL-9921",
      litres: 65.5,
      cost_usd: 104.80,
      odometer_km: 15680.0
    }
  }), rFuel);

  assert.equal(rFuel.statusCode, 201);
  assert.equal(rFuel.body.data.cost_usd, 104.80);
  assert.equal(rFuel.body.data.currency, "USD");
});

// ── 2. Sensitive Control S-12: Vehicle VID Roadworthiness Expiry Lock ───────

test("security & safety gate S-12: expired VID roadworthiness strictly blocks vehicle dispatch", () => {
  const w = createTestWorld();

  // Register vehicle with an expired VID date (yesterday)
  const expiredDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const rVeh = res();
  createVehicle(as(w, "Operations", {
    body: {
      plate_number: "AFL-4401",
      make: "Nissan",
      model: "Hardbody 4x4",
      year: 2020,
      vehicle_type: "4X4_FIELD_BAKKIE",
      current_odometer_km: 98000.0,
      vid_certificate_number: "VID-2025-EXPIRED",
      vid_expiry_date: expiredDate,
      insurance_expiry_date: "2027-12-31"
    }
  }), rVeh);

  assert.equal(rVeh.statusCode, 201);
  const vehicle = rVeh.body.data;

  // Attempt dispatch -> must be hard blocked
  const rDisp = res();
  dispatchVehicle(as(w, "Supervisor", {
    body: {
      vehicle_id: vehicle.id,
      driver_id: "u-technician",
      driver_name: "Technician User",
      destination: "Mimosa Concentrator",
      purpose: "Emergency conveyor belt splicing",
      departure_odometer_km: 98000.0
    }
  }), rDisp);

  assert.equal(rDisp.statusCode, 403);
  assert.equal(rDisp.body.success, false);
  assert.equal(rDisp.body.code, "VID_EXPIRED_LOCK");
  assert.match(rDisp.body.message, /VID roadworthiness certificate expired/);

  // Vehicle must remain AVAILABLE/GROUNDED and NOT marked DISPATCHED
  assert.equal(vehicle.status, "AVAILABLE");
  assert.equal(w.db.vehicle_dispatches.length, 0);
});

// ── 3. Sensitive Control S-11: Pre-Dispatch PPE Gate ────────────────────────

test("security & safety gate S-11: pre-dispatch PPE inspection strictly blocks artisan dispatch on any failed item", () => {
  const w = createTestWorld();

  // Technician missing respirator mask and safety glasses
  const rPpeFail = res();
  recordPreDispatchPpe(as(w, "Supervisor", {
    body: {
      dispatch_card_id: "dc-101",
      technician_id: "u-technician",
      technician_name: "Tendai Shumba",
      site_location: "Zimplats SMC Rubber Lining Tank",
      hard_hat_pass: true,
      metatarsal_boots_pass: true,
      heavy_chemical_gloves_pass: true,
      safety_glasses_pass: false, // FAILED
      high_vis_vest_pass: true,
      respirator_mask_pass: false, // FAILED
      ear_protection_pass: true,
      fall_arrest_harness_pass: true
    }
  }), rPpeFail);

  assert.equal(rPpeFail.statusCode, 400);
  assert.equal(rPpeFail.body.success, false);
  assert.equal(rPpeFail.body.code, "PPE_INSPECTION_FAILED");
  assert.equal(rPpeFail.body.data.status, "FAILED_BLOCKED");
  assert.equal(rPpeFail.body.data.all_items_passed, false);

  // Re-inspection with 100% compliant equipment -> APPROVED
  const rPpePass = res();
  recordPreDispatchPpe(as(w, "Supervisor", {
    body: {
      dispatch_card_id: "dc-101",
      technician_id: "u-technician",
      technician_name: "Tendai Shumba",
      site_location: "Zimplats SMC Rubber Lining Tank",
      hard_hat_pass: true,
      metatarsal_boots_pass: true,
      heavy_chemical_gloves_pass: true,
      safety_glasses_pass: true,
      high_vis_vest_pass: true,
      respirator_mask_pass: true,
      ear_protection_pass: true,
      fall_arrest_harness_pass: true
    }
  }), rPpePass);

  assert.equal(rPpePass.statusCode, 201);
  assert.equal(rPpePass.body.success, true);
  assert.equal(rPpePass.body.data.status, "PASSED");
  assert.equal(rPpePass.body.data.all_items_passed, true);
});

// ── 4. Daily Toolbox Talks & Incident Reporting ──────────────────────────────

test("HSE operations: toolbox talks and incident near-miss reporting", () => {
  const w = createTestWorld();

  // 1. Log Daily Toolbox Talk
  const rTalk = res();
  createToolboxTalk(as(w, "Supervisor", {
    body: {
      talk_date: "2026-11-17",
      topic: "Chemical Solvent Vapors & Cold Splicing LOTO",
      site_location: "Unki Mine Concentrator",
      attendees: [
        { technician_id: "u-technician", name: "Technician User", signature_present: true }
      ],
      hazards_identified: "Solvent inhalation, toxic fumes in pit",
      control_measures: "Use dual-cartridge respirators, force ventilation, constant atmospheric monitoring"
    }
  }), rTalk);

  assert.equal(rTalk.statusCode, 201);
  assert.equal(rTalk.body.data.topic, "Chemical Solvent Vapors & Cold Splicing LOTO");

  // 2. Report Incident
  const rInc = res();
  reportIncident(as(w, "Supervisor", {
    body: {
      incident_date: "2026-11-17T09:30:00Z",
      site_location: "Unki Concentrator",
      severity: "NEAR_MISS",
      description: "Fastener dropped from overhead chute during belt clamp tightening; hit barricade.",
      immediate_action_taken: "Work stopped, lanyard attached to all hand tools, exclusion zone expanded.",
      root_cause: "Tool lanyard was not tethered before aloft work began.",
      corrective_preventative_action: "All artisan aloft work requires 100% tethered hand tool policy."
    }
  }), rInc);

  assert.equal(rInc.statusCode, 201);
  assert.equal(rInc.body.data.severity, "NEAR_MISS");
  assert.equal(rInc.body.data.status, "OPEN");

  // 3. Check HSE summary
  const rSum = res();
  getHseSummary(as(w, "Management"), rSum);
  assert.equal(rSum.statusCode, 200);
  assert.equal(rSum.body.data.total_toolbox_talks, 1);
  assert.equal(rSum.body.data.total_incidents, 1);
  assert.equal(rSum.body.data.open_incidents, 1);
});
