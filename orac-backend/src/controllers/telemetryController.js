// backend/src/controllers/telemetryController.js
//
// Controller for Subsystem 12: Plant IoT Telemetry & Predictive Maintenance.
// Handles industrial sensor webhook ingestion, wear analytics, and alert triage.

import {
  IngestTelemetrySchema,
  ResolveAlertSchema
} from "../schemas.js";

import {
  processTelemetryStream,
  calculateEquipmentConditionMetrics,
  buildTelemetryExecutiveSummary
} from "../services/iotTelemetryService.js";

function getActor(req) {
  if (!req.db || !req.db.users) return { id: req.user?.id || "u-sys", role: "Admin", name: "System User" };
  const u = req.db.users.find((user) => user.id === req.user?.id);
  return u || { id: req.user?.id || "u-sys", role: "Admin", name: "System User" };
}

function checkPermission(actor, allowedRoles = ["Admin", "Management", "Operations", "Supervisor", "Technician"]) {
  if (!actor || !allowedRoles.includes(actor.role)) {
    const err = new Error(`Forbidden: role '${actor?.role}' lacks permission`);
    err.statusCode = 403;
    throw err;
  }
}

export const ingestTelemetry = (req, res) => {
  try {
    const actor = getActor(req);
    // Open to technicians, operations, admin or automated gateway tokens
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Technician"]);

    const parseResult = IngestTelemetrySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid telemetry payload",
        errors: parseResult.error.issues
      });
    }

    const result = processTelemetryStream(req.db, req.store, actor, parseResult.data);

    return res.status(201).json({
      success: true,
      data: result
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const getEquipmentTelemetry = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Technician", "Sales", "Client Viewer"]);

    const metrics = calculateEquipmentConditionMetrics(req.db.iot_sensor_telemetries, req.params.tagId);

    return res.json({
      success: true,
      data: metrics
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const listAlerts = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Technician", "Sales"]);

    req.db.iot_threshold_alerts = req.db.iot_threshold_alerts || [];
    let list = [...req.db.iot_threshold_alerts];

    if (req.query.status) {
      list = list.filter((a) => a.status === req.query.status);
    }
    if (req.query.severity) {
      list = list.filter((a) => a.severity === req.query.severity);
    }

    return res.json({
      success: true,
      data: list
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const resolveAlert = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor"]);

    req.db.iot_threshold_alerts = req.db.iot_threshold_alerts || [];
    const alert = req.db.iot_threshold_alerts.find((a) => a.id === req.params.id);

    if (!alert) {
      return res.status(404).json({ success: false, message: "Alert not found" });
    }

    const parseResult = ResolveAlertSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid alert resolution data",
        errors: parseResult.error.issues
      });
    }

    alert.status = "RESOLVED";
    alert.resolution_notes = parseResult.data.resolution_notes;
    alert.action_taken = parseResult.data.action_taken;
    alert.resolved_by_id = actor.id;
    alert.resolved_at = new Date().toISOString();

    req.store.audit(req.db, actor, "iot_threshold_alerts", alert.id, "IOT_ALERT_RESOLVED", null, {
      action_taken: alert.action_taken,
      resolution_notes: alert.resolution_notes
    });

    return res.json({
      success: true,
      data: alert
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const getTelemetrySummary = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Sales"]);

    const summary = buildTelemetryExecutiveSummary(req.db);

    return res.json({
      success: true,
      data: summary
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};
