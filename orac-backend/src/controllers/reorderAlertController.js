/**
 * reorderAlertController.js — HTTP handlers for Reorder Alerts
 *
 * Routes:
 *   POST   /inventory/reorder-alerts/scan         — scan inventory and generate alerts
 *   GET    /inventory/reorder-alerts               — list open alerts
 *   GET    /inventory/reorder-alerts/summary       — alert summary (counts by urgency)
 *   POST   /inventory/reorder-alerts/:id/acknowledge — acknowledge an alert
 *   POST   /inventory/reorder-alerts/:id/dismiss     — dismiss an alert
 */

import {
  scanAndGenerateAlerts,
  getOpenAlerts,
  acknowledgeAlert,
  dismissAlert,
  getAlertSummary,
} from "../services/reorderAlertService.js";

export function postScanAlerts(req, res) {
  try {
    const db = req.app.locals.store?.db || req.app.locals.db;
    const alerts = scanAndGenerateAlerts({ db });
    res.json({ ok: true, alerts, count: alerts.length });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function getAlerts(req, res) {
  try {
    const db = req.app.locals.store?.db || req.app.locals.db;
    const { urgency } = req.query;
    const alerts = getOpenAlerts({ db, urgency });
    res.json({ ok: true, alerts, count: alerts.length });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function getSummary(req, res) {
  try {
    const db = req.app.locals.store?.db || req.app.locals.db;
    const summary = getAlertSummary({ db });
    res.json({ ok: true, summary });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function postAcknowledge(req, res) {
  try {
    const db = req.app.locals.store?.db || req.app.locals.db;
    const alert = acknowledgeAlert({
      alertId: req.params.id,
      acknowledgedBy: req.user?.id || req.body.acknowledgedBy,
      db,
    });
    res.json({ ok: true, alert });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function postDismiss(req, res) {
  try {
    const db = req.app.locals.store?.db || req.app.locals.db;
    const alert = dismissAlert({
      alertId: req.params.id,
      dismissedBy: req.user?.id || req.body.dismissedBy,
      reason: req.body.reason,
      db,
    });
    res.json({ ok: true, alert });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}
