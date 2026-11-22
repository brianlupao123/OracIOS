/**
 * fleetComplianceController.js — HTTP handlers for Fleet Compliance
 *
 * Routes:
 *   POST   /fleet/odometer                          — log an odometer reading
 *   GET    /fleet/odometer/:vehicleId                — odometer history for a vehicle
 *   GET    /fleet/odometer/:vehicleId/stats          — mileage stats
 *   GET    /fleet/compliance                         — scan fleet for expiry alerts
 *   GET    /fleet/compliance/alerts                  — get existing expiry alerts
 *   POST   /fleet/maintenance                        — create a maintenance request
 *   POST   /fleet/maintenance/:id/transition         — transition a maintenance request
 */

import {
  logOdometerReading,
  getOdometerHistory,
  getMileageStats,
  scanFleetCompliance,
  getFleetExpiryAlerts,
  createMaintenanceRequest,
  transitionMaintenanceRequest,
} from "../services/fleetComplianceService.js";

function getDb(req) {
  return req.db || req.store?.db || req.app?.locals?.store?.db || req.app?.locals?.db;
}

export function postOdometerReading(req, res) {
  try {
    const db = getDb(req);
    const reading = logOdometerReading({
      vehicleId: req.body.vehicleId,
      readingKm: req.body.readingKm,
      recordedBy: req.user?.id || req.body.recordedBy,
      notes: req.body.notes,
      db,
    });
    res.status(201).json({ ok: true, reading });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function getOdometer(req, res) {
  try {
    const db = getDb(req);
    const history = getOdometerHistory({
      vehicleId: req.params.vehicleId,
      db,
    });
    res.json({ ok: true, readings: history });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function getStats(req, res) {
  try {
    const db = getDb(req);
    const stats = getMileageStats({
      vehicleId: req.params.vehicleId,
      db,
    });
    res.json({ ok: true, stats });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function getScanCompliance(req, res) {
  try {
    const db = getDb(req);
    const results = scanFleetCompliance({ db });
    res.json({ ok: true, ...results });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function getExpiryAlerts(req, res) {
  try {
    const db = getDb(req);
    const alerts = getFleetExpiryAlerts({ db });
    res.json({ ok: true, alerts });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function postMaintenanceRequest(req, res) {
  try {
    const db = getDb(req);
    const request = createMaintenanceRequest({
      vehicleId: req.body.vehicleId,
      requestedBy: req.user?.id || req.body.requestedBy,
      description: req.body.description,
      priority: req.body.priority,
      db,
    });
    res.status(201).json({ ok: true, request });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function postMaintenanceTransition(req, res) {
  try {
    const db = getDb(req);
    const request = transitionMaintenanceRequest({
      requestId: req.params.id,
      action: req.body.action,
      performedBy: req.user?.id || req.body.performedBy,
      notes: req.body.notes,
      db,
    });
    res.json({ ok: true, request });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}
