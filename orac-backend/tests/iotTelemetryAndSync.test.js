// backend/tests/iotTelemetryAndSync.test.js
//
// Subsystems 12 & 13: Plant IoT Telemetry & Offline Sync Engine
// Tests sensor ingestion, vibration/temperature condition monitoring,
// predictive maintenance auto-quotes (USD S-08), and offline sync conflict resolution.

import test from "node:test";
import assert from "node:assert/strict";

import {
  ingestTelemetry,
  getEquipmentTelemetry,
  listAlerts,
  resolveAlert,
  getTelemetrySummary
} from "../src/controllers/telemetryController.js";

import {
  syncBatchMutations,
  getSyncJournal,
  resolveConflict
} from "../src/controllers/syncController.js";

import {
  THRESHOLDS,
  evaluateTelemetryMetrics,
  calculateEquipmentConditionMetrics
} from "../src/services/iotTelemetryService.js";

function createMockReqRes({ user, body = {}, params = {}, query = {}, db = {} }) {
  let statusCode = 200;
  let responseData = null;

  const req = {
    user: user || { id: "u-tech", role: "Technician", name: "Field Sensor Specialist" },
    body,
    params,
    query,
    db: {
      users: [
        { id: "u-admin", role: "Admin", name: "Admin Lead" },
        { id: "u-supervisor", role: "Supervisor", name: "Operations Supervisor" },
        { id: "u-tech", role: "Technician", name: "Field Sensor Specialist" }
      ],
      iot_sensor_telemetries: [],
      iot_threshold_alerts: [],
      offline_sync_journal: [],
      quotes: [],
      quote_lines: [],
      timesheets: [],
      equipment_tags: [],
      audit_logs: [],
      ...db
    },
    store: {
      id: (prefix = "id") => `${prefix}-${Math.random().toString(36).slice(2, 9)}`,
      audit: (database, actor, targetType, targetId, action, before, after) => {
        database.audit_logs = database.audit_logs || [];
        database.audit_logs.push({
          id: `aud-${Date.now()}`,
          actor_id: actor?.id || "u-sys",
          target_type: targetType,
          target_id: targetId,
          action,
          before,
          after,
          timestamp: new Date().toISOString()
        });
      }
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

test("Plant IoT Telemetry: in-spec readings record as NORMAL with zero alerts", () => {
  const { req, res } = createMockReqRes({
    body: {
      sensor_id: "SENS-VIB-01",
      equipment_tag_id: "TAG-PU-101",
      equipment_tag_name: "Primary Slurry Feed Pump PU-101",
      client_id: "c-zimplats",
      client_name: "Zimplats SMC",
      mine_site: "ZIMPLATS_SMC",
      timestamp: new Date().toISOString(),
      metrics: {
        vibration_rms_mms: 2.1, // well below 4.5 mm/s warning threshold
        bearing_temp_celsius: 52.0, // well below 75 C warning threshold
        casing_wear_depth_mm: 3.2, // well below 6.0 mm warning threshold
        pump_flow_rate_m3h: 420.0
      }
    }
  });

  ingestTelemetry(req, res);

  assert.equal(res.getStatusCode(), 201);
  const data = res.getData();
  assert.equal(data.success, true);
  assert.equal(data.data.telemetry.status, "NORMAL");
  assert.equal(data.data.alert, null);
  assert.equal(data.data.quote, null);
  assert.equal(req.db.iot_sensor_telemetries.length, 1);
  assert.equal(req.db.iot_threshold_alerts.length, 0);
});

test("Plant IoT Telemetry: high vibration triggers WARNING alert", () => {
  const { req, res } = createMockReqRes({
    body: {
      sensor_id: "SENS-VIB-01",
      equipment_tag_id: "TAG-PU-101",
      equipment_tag_name: "Primary Slurry Feed Pump PU-101",
      metrics: {
        vibration_rms_mms: 5.8, // breaches 4.5 mm/s warning threshold
        bearing_temp_celsius: 68.0,
        casing_wear_depth_mm: 4.5
      }
    }
  });

  ingestTelemetry(req, res);

  assert.equal(res.getStatusCode(), 201);
  const data = res.getData();
  assert.equal(data.data.telemetry.status, "WARNING");
  assert.ok(data.data.alert);
  assert.equal(data.data.alert.severity, "WARNING");
  assert.equal(data.data.alert.alert_type, "HIGH_VIBRATION");
  assert.equal(req.db.iot_threshold_alerts.length, 1);
});

test("Predictive Maintenance Trigger: critical wear depth auto-generates USD quotation draft (S-08)", () => {
  const { req, res } = createMockReqRes({
    body: {
      sensor_id: "SENS-WEAR-01",
      equipment_tag_id: "TAG-PU-101",
      equipment_tag_name: "Primary Slurry Feed Pump PU-101",
      client_id: "c-zimplats",
      client_name: "Zimplats SMC",
      mine_site: "ZIMPLATS_SMC",
      metrics: {
        vibration_rms_mms: 4.8,
        bearing_temp_celsius: 72.0,
        casing_wear_depth_mm: 8.4 // breaches 8.0 mm critical threshold!
      }
    }
  });

  ingestTelemetry(req, res);

  assert.equal(res.getStatusCode(), 201);
  const data = res.getData();
  assert.equal(data.data.telemetry.status, "CRITICAL");
  assert.ok(data.data.alert);
  assert.equal(data.data.alert.severity, "CRITICAL");
  assert.equal(data.data.alert.alert_type, "CRITICAL_WEAR_DEPTH");

  // Predictive quote auto-generated
  assert.ok(data.data.quote, "A predictive draft quote must be generated on critical wear");
  const quote = data.data.quote;
  assert.equal(quote.status, "Draft");
  assert.equal(quote.currency, "USD", "Sensitive Control S-08: Currency must be strictly USD");
  assert.equal(quote.total_amount, 4850.00);
  assert.equal(quote.is_predictive_iot_trigger, true);

  // Quote lines generated in DB
  const quoteLines = req.db.quote_lines.filter((ql) => ql.quote_id === quote.id);
  assert.equal(quoteLines.length, 3);
  for (const line of quoteLines) {
    assert.equal(line.currency, "USD");
  }

  // Audit log present
  const audit = req.db.audit_logs.find((a) => a.action === "PREDICTIVE_MAINTENANCE_QUOTE_GENERATED");
  assert.ok(audit);
  assert.equal(audit.after.currency, "USD");
});

test("Condition Monitoring Analytics: calculates wear velocity and time to critical failure", () => {
  const telemetryList = [
    {
      equipment_tag_id: "TAG-PU-101",
      equipment_tag_name: "Primary Slurry Feed Pump PU-101",
      client_name: "Zimplats SMC",
      mine_site: "ZIMPLATS_SMC",
      timestamp: "2026-11-01T08:00:00Z",
      vibration_rms_mms: 2.2,
      bearing_temp_celsius: 50.0,
      casing_wear_depth_mm: 5.0,
      status: "NORMAL"
    },
    {
      equipment_tag_id: "TAG-PU-101",
      equipment_tag_name: "Primary Slurry Feed Pump PU-101",
      client_name: "Zimplats SMC",
      mine_site: "ZIMPLATS_SMC",
      timestamp: "2026-11-10T08:00:00Z",
      vibration_rms_mms: 3.4,
      bearing_temp_celsius: 62.0,
      casing_wear_depth_mm: 6.5,
      status: "WARNING"
    },
    {
      equipment_tag_id: "TAG-PU-101",
      equipment_tag_name: "Primary Slurry Feed Pump PU-101",
      client_name: "Zimplats SMC",
      mine_site: "ZIMPLATS_SMC",
      timestamp: "2026-11-17T08:00:00Z",
      vibration_rms_mms: 4.8,
      bearing_temp_celsius: 74.0,
      casing_wear_depth_mm: 7.8,
      status: "WARNING"
    }
  ];

  const metrics = calculateEquipmentConditionMetrics(telemetryList, "TAG-PU-101");
  assert.equal(metrics.total_readings, 3);
  assert.equal(metrics.current_status, "WARNING");
  assert.equal(metrics.latest_casing_wear_depth, 7.8);
  assert.ok(metrics.projected_readings_to_critical > 0);
  assert.equal(metrics.history.length, 3);
});

test("Alert Resolution: supervisor resolves threshold breach with maintenance action", () => {
  const { req, res } = createMockReqRes({
    user: { id: "u-supervisor", role: "Supervisor", name: "Operations Supervisor" },
    params: { id: "alt-001" },
    body: {
      resolution_notes: "Technician dispatched to replace slurry pump suction rubber gasket.",
      action_taken: "SCHEDULE_RELINING"
    },
    db: {
      iot_threshold_alerts: [
        {
          id: "alt-001",
          equipment_tag_id: "TAG-PU-101",
          status: "ACTIVE",
          severity: "CRITICAL"
        }
      ]
    }
  });

  resolveAlert(req, res);

  assert.equal(res.getStatusCode(), 200);
  const updated = res.getData().data;
  assert.equal(updated.status, "RESOLVED");
  assert.equal(updated.action_taken, "SCHEDULE_RELINING");
  assert.equal(updated.resolved_by_id, "u-supervisor");
});

test("Offline Sync: batches offline mutations with idempotency and non-destructive merge", () => {
  const sharedDb = {
    timesheets: [
      { id: "ts-001", worker_name: "Artisan Takunda", normal_hours: 8, status: "Draft", created_at: "2026-11-17T06:00:00Z" }
    ],
    offline_sync_journal: []
  };

  const { req, res } = createMockReqRes({
    db: sharedDb,
    body: {
      client_device_id: "TAB-TECH-04",
      mutations: [
        {
          client_mutation_id: "mut-001",
          entity_type: "timesheet",
          entity_id: "ts-002",
          operation: "INSERT",
          client_timestamp: "2026-11-17T07:00:00Z",
          payload: {
            worker_name: "Artisan Farai",
            normal_hours: 8,
            overtime_hours: 2,
            status: "Submitted"
          }
        },
        {
          client_mutation_id: "mut-002",
          entity_type: "timesheet",
          entity_id: "ts-001",
          operation: "UPDATE",
          client_timestamp: "2026-11-17T07:30:00Z",
          payload: {
            notes: "Suction liner relining completed on underground slurry station."
          }
        }
      ]
    }
  });

  syncBatchMutations(req, res);

  assert.equal(res.getStatusCode(), 200);
  const data = res.getData();
  assert.equal(data.total_processed, 2);
  assert.equal(data.committed_count, 2);
  assert.equal(data.conflict_count, 0);

  // Verifying inserted timesheet
  const inserted = sharedDb.timesheets.find((t) => t.id === "ts-002");
  assert.ok(inserted);
  assert.equal(inserted.worker_name, "Artisan Farai");

  // Verifying updated timesheet has merged notes
  const updated = sharedDb.timesheets.find((t) => t.id === "ts-001");
  assert.ok(updated);
  assert.equal(updated.normal_hours, 8);
  assert.equal(updated.notes, "Suction liner relining completed on underground slurry station.");

  // Idempotency: replaying exact same batch mutations must not duplicate
  const { req: req2, res: res2 } = createMockReqRes({ db: sharedDb, body: req.body });
  syncBatchMutations(req2, res2);
  assert.equal(res2.getStatusCode(), 200);
  assert.equal(res2.getData().results[0].replayed, true);
  assert.equal(res2.getData().results[1].replayed, true);
  assert.equal(sharedDb.timesheets.length, 2);
});
