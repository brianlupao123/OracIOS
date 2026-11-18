/**
 * Tests for Fleet Mileage & Compliance Service.
 *
 * Tests:
 *  - Odometer logging: recording, validation, history
 *  - Mileage stats: average daily/monthly km, service intervals
 *  - Fleet compliance scanning: expired, expiring_soon, valid
 *  - Fleet expiry alerts: dashboard summary
 *  - Maintenance requests: CRUD, state machine
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  logOdometerReading,
  getOdometerHistory,
  getMileageStats,
  scanFleetCompliance,
  getFleetExpiryAlerts,
  createMaintenanceRequest,
  transitionMaintenanceRequest,
  listMaintenanceRequests,
  MAINTENANCE_STATES
} from "../src/services/fleetComplianceService.js";

// ── Helpers ─────────────────────────────────────────────────────────

function makeDb(overrides = {}) {
  const today = new Date();
  const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return d.toISOString().split("T")[0]; };
  const daysFromNow = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d.toISOString().split("T")[0]; };

  return {
    vehicles: [
      {
        id: "v-1", registration_number: "ZW-ABC-123",
        make: "Toyota", model: "Land Cruiser",
        current_odometer_km: 85000,
        vid_expiry_date: daysFromNow(90),
        insurance_expiry_date: daysFromNow(15),  // expiring soon
        licence_expiry_date: daysFromNow(200)
      },
      {
        id: "v-2", registration_number: "ZW-DEF-456",
        make: "Isuzu", model: "NQR",
        current_odometer_km: 120000,
        vid_expiry_date: daysAgo(10),  // EXPIRED
        insurance_expiry_date: daysFromNow(60),
        licence_expiry_date: daysFromNow(5)  // expiring soon
      },
      {
        id: "v-3", registration_number: "ZW-GHI-789",
        make: "Toyota", model: "Hilux",
        current_odometer_km: 45000,
        vid_expiry_date: daysFromNow(180),
        insurance_expiry_date: daysFromNow(180),
        licence_expiry_date: daysFromNow(300)
      }
    ],
    odometer_readings: [],
    maintenance_requests: [],
    ...overrides
  };
}

function makeStore() {
  const auditLog = [];
  return {
    audit: (db, actor, collection, docId, action, before, after) => {
      auditLog.push({ actor: actor.id, collection, docId, action, before, after });
    },
    _auditLog: auditLog
  };
}

// ═════════════════════════════════════════════════════════════════════
// Odometer Logging
// ═════════════════════════════════════════════════════════════════════

describe("fleetComplianceService — logOdometerReading", () => {
  it("records a reading and updates vehicle odometer", () => {
    const db = makeDb();
    const store = makeStore();

    const reading = logOdometerReading({
      vehicleId: "v-1", readingKm: 86000,
      readingDate: "2026-12-01", source: "manual",
      notes: "Weekly check", userId: "tech-1", store, db
    });

    assert.ok(reading.id.startsWith("odom_"));
    assert.equal(reading.vehicle_id, "v-1");
    assert.equal(reading.reading_km, 86000);
    assert.equal(reading.source, "manual");

    // Vehicle odometer should be updated
    const vehicle = db.vehicles.find(v => v.id === "v-1");
    assert.equal(vehicle.current_odometer_km, 86000);
    assert.equal(db.odometer_readings.length, 1);
  });

  it("rejects reading less than current odometer", () => {
    const db = makeDb();
    assert.throws(
      () => logOdometerReading({ vehicleId: "v-1", readingKm: 80000, db }),
      /don't go backwards/
    );
  });

  it("rejects negative reading", () => {
    const db = makeDb();
    assert.throws(
      () => logOdometerReading({ vehicleId: "v-1", readingKm: -100, db }),
      /cannot be negative/
    );
  });

  it("throws 404 for unknown vehicle", () => {
    const db = makeDb();
    assert.throws(
      () => logOdometerReading({ vehicleId: "v-999", readingKm: 1000, db }),
      /Vehicle not found/
    );
  });

  it("throws 400 for missing vehicleId", () => {
    const db = makeDb();
    assert.throws(
      () => logOdometerReading({ readingKm: 1000, db }),
      /vehicleId is required/
    );
  });

  it("creates audit entry", () => {
    const db = makeDb();
    const store = makeStore();
    logOdometerReading({ vehicleId: "v-1", readingKm: 86000, userId: "tech-1", store, db });
    assert.equal(store._auditLog.length, 1);
    assert.equal(store._auditLog[0].action, "ODOMETER_LOGGED");
  });
});

describe("fleetComplianceService — getOdometerHistory", () => {
  it("returns readings for a specific vehicle, newest first", () => {
    const db = makeDb();
    logOdometerReading({ vehicleId: "v-1", readingKm: 86000, readingDate: "2026-12-01", db });
    logOdometerReading({ vehicleId: "v-1", readingKm: 87000, readingDate: "2026-12-08", db });
    logOdometerReading({ vehicleId: "v-3", readingKm: 46000, readingDate: "2026-12-01", db });

    const history = getOdometerHistory({ vehicleId: "v-1", db });
    assert.equal(history.length, 2);
    assert.equal(history[0].reading_km, 87000);  // newest first
    assert.equal(history[1].reading_km, 86000);
  });
});

describe("fleetComplianceService — getMileageStats", () => {
  it("calculates average daily and monthly km", () => {
    const db = makeDb();
    logOdometerReading({ vehicleId: "v-1", readingKm: 85000, readingDate: "2026-11-01", db });
    logOdometerReading({ vehicleId: "v-1", readingKm: 88000, readingDate: "2026-12-01", db });

    const stats = getMileageStats({ vehicleId: "v-1", db });
    assert.equal(stats.totalKm, 3000);
    assert.equal(stats.totalDays, 30);
    assert.equal(stats.avgDailyKm, 100);
    assert.equal(stats.avgMonthlyKm, 3000);
    assert.equal(stats.totalReadings, 2);
  });

  it("returns null stats with insufficient readings", () => {
    const db = makeDb();
    const stats = getMileageStats({ vehicleId: "v-1", db });
    assert.equal(stats.avgDailyKm, null);
    assert.equal(stats.avgMonthlyKm, null);
  });

  it("throws 404 for unknown vehicle", () => {
    const db = makeDb();
    assert.throws(
      () => getMileageStats({ vehicleId: "v-999", db }),
      /Vehicle not found/
    );
  });
});

// ═════════════════════════════════════════════════════════════════════
// Fleet Compliance Scanning
// ═════════════════════════════════════════════════════════════════════

describe("fleetComplianceService — scanFleetCompliance", () => {
  it("classifies vehicle documents as expired, expiring_soon, or valid", () => {
    const db = makeDb();
    const results = scanFleetCompliance({ warningDays: 30, db });

    assert.equal(results.length, 3);

    // v-2 has expired VID → overall expired
    const v2 = results.find(r => r.vehicleId === "v-2");
    assert.equal(v2.overallStatus, "expired");
    assert.ok(v2.checks.some(c => c.category === "roadworthiness" && c.status === "expired"));

    // v-1 has insurance expiring in 15 days → expiring_soon
    const v1 = results.find(r => r.vehicleId === "v-1");
    assert.equal(v1.overallStatus, "expiring_soon");
    assert.ok(v1.checks.some(c => c.category === "insurance" && c.status === "expiring_soon"));

    // v-3 all valid (90+ days)
    const v3 = results.find(r => r.vehicleId === "v-3");
    assert.equal(v3.overallStatus, "valid");
  });

  it("sorts results: expired first, then expiring_soon, then valid", () => {
    const db = makeDb();
    const results = scanFleetCompliance({ db });

    assert.equal(results[0].overallStatus, "expired");
    assert.equal(results[results.length - 1].overallStatus, "valid");
  });

  it("includes vehicle details in results", () => {
    const db = makeDb();
    const results = scanFleetCompliance({ db });
    const v1 = results.find(r => r.vehicleId === "v-1");

    assert.equal(v1.registration, "ZW-ABC-123");
    assert.equal(v1.make, "Toyota");
    assert.equal(v1.model, "Land Cruiser");
  });

  it("handles missing expiry dates as not_set", () => {
    const db = makeDb({
      vehicles: [
        { id: "v-no-dates", registration_number: "ZW-000-000" }
      ]
    });
    const results = scanFleetCompliance({ db });
    const v = results[0];

    assert.ok(v.checks.every(c => c.status === "not_set"));
    assert.equal(v.overallStatus, "valid");
  });
});

describe("fleetComplianceService — getFleetExpiryAlerts", () => {
  it("returns only flagged vehicles with counts", () => {
    const db = makeDb();
    const alerts = getFleetExpiryAlerts({ warningDays: 30, db });

    assert.equal(alerts.total, 2);  // v-1 (expiring_soon) and v-2 (expired)
    assert.equal(alerts.expired, 1);
    assert.equal(alerts.expiringSoon, 1);
    assert.equal(alerts.vehicles.length, 2);
  });

  it("returns empty when all vehicles are valid", () => {
    const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().split("T")[0]; };
    const db = makeDb({
      vehicles: [
        {
          id: "v-ok", vid_expiry_date: daysFromNow(100),
          insurance_expiry_date: daysFromNow(100), licence_expiry_date: daysFromNow(100)
        }
      ]
    });
    const alerts = getFleetExpiryAlerts({ warningDays: 30, db });
    assert.equal(alerts.total, 0);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Maintenance Requests
// ═════════════════════════════════════════════════════════════════════

describe("fleetComplianceService — createMaintenanceRequest", () => {
  it("creates a request in Requested state", () => {
    const db = makeDb();
    const store = makeStore();
    const req = createMaintenanceRequest({
      vehicleId: "v-1", requestType: "scheduled_service",
      description: "50,000 km service due", priority: "normal",
      requestedBy: "fleet-mgr-1", store, db
    });

    assert.ok(req.id.startsWith("maint_"));
    assert.equal(req.status, "Requested");
    assert.equal(req.vehicle_id, "v-1");
    assert.equal(req.request_type, "scheduled_service");
    assert.equal(req.registration, "ZW-ABC-123");
    assert.equal(db.maintenance_requests.length, 1);
  });

  it("throws 400 for missing required fields", () => {
    const db = makeDb();
    assert.throws(() => createMaintenanceRequest({ requestType: "repair", description: "test", db }), /vehicleId/);
    assert.throws(() => createMaintenanceRequest({ vehicleId: "v-1", description: "test", db }), /requestType/);
    assert.throws(() => createMaintenanceRequest({ vehicleId: "v-1", requestType: "repair", db }), /description/);
  });

  it("throws 404 for unknown vehicle", () => {
    const db = makeDb();
    assert.throws(
      () => createMaintenanceRequest({ vehicleId: "v-999", requestType: "repair", description: "fix", db }),
      /Vehicle not found/
    );
  });
});

describe("fleetComplianceService — transitionMaintenanceRequest", () => {
  it("follows happy path: Requested → Approved → In_Progress → Completed", () => {
    const db = makeDb();
    const store = makeStore();
    const req = createMaintenanceRequest({
      vehicleId: "v-1", requestType: "repair",
      description: "Engine warning light", store, db
    });

    transitionMaintenanceRequest({ requestId: req.id, newStatus: "Approved", userId: "mgr-1", store, db });
    assert.equal(req.status, "Approved");
    assert.equal(req.approved_by, "mgr-1");

    transitionMaintenanceRequest({ requestId: req.id, newStatus: "In_Progress", userId: "tech-1", store, db });
    assert.equal(req.status, "In_Progress");

    transitionMaintenanceRequest({
      requestId: req.id, newStatus: "Completed",
      userId: "tech-1", notes: "Replaced oil pressure sensor", store, db
    });
    assert.equal(req.status, "Completed");
    assert.equal(req.completion_notes, "Replaced oil pressure sensor");
  });

  it("allows rejection from Requested", () => {
    const db = makeDb();
    const store = makeStore();
    const req = createMaintenanceRequest({
      vehicleId: "v-1", requestType: "repair", description: "test", store, db
    });

    transitionMaintenanceRequest({ requestId: req.id, newStatus: "Rejected", userId: "mgr-1", store, db });
    assert.equal(req.status, "Rejected");
  });

  it("rejects invalid transition", () => {
    const db = makeDb();
    const store = makeStore();
    const req = createMaintenanceRequest({
      vehicleId: "v-1", requestType: "repair", description: "test", store, db
    });

    assert.throws(
      () => transitionMaintenanceRequest({ requestId: req.id, newStatus: "Completed", store, db }),
      /Invalid transition/
    );
  });

  it("throws 404 for unknown request", () => {
    const db = makeDb();
    assert.throws(
      () => transitionMaintenanceRequest({ requestId: "maint_unknown", newStatus: "Approved", db }),
      /not found/
    );
  });
});

describe("fleetComplianceService — listMaintenanceRequests", () => {
  it("lists and filters maintenance requests", () => {
    const db = makeDb();
    const store = makeStore();
    createMaintenanceRequest({ vehicleId: "v-1", requestType: "repair", description: "Job 1", store, db });
    createMaintenanceRequest({ vehicleId: "v-2", requestType: "tyre", description: "Job 2", store, db });

    assert.equal(listMaintenanceRequests({ db }).length, 2);
    assert.equal(listMaintenanceRequests({ vehicleId: "v-1", db }).length, 1);
    assert.equal(listMaintenanceRequests({ status: "Requested", db }).length, 2);
  });
});

describe("fleetComplianceService — MAINTENANCE_STATES", () => {
  it("defines 5 states", () => {
    assert.equal(MAINTENANCE_STATES.length, 5);
    assert.ok(MAINTENANCE_STATES.includes("Requested"));
    assert.ok(MAINTENANCE_STATES.includes("Completed"));
  });
});
