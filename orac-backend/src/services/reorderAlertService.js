/**
 * Reorder Alert Service.
 *
 * Automatically scans inventory items and generates reorder alerts
 * when stock levels fall at or below the configured reorder_level.
 *
 * Features:
 *  - scanAndGenerateAlerts():  Scans all items, creates alerts for
 *                              those below reorder_level, deduplicates
 *                              against existing open alerts.
 *  - getOpenAlerts():          Returns all unacknowledged alerts.
 *  - acknowledgeAlert():       Marks an alert as acknowledged (e.g.
 *                              after PO raised or manual restock).
 *  - dismissAlert():           Dismisses a false-positive alert.
 *  - getAlertSummary():        Dashboard-ready summary: count by
 *                              urgency (critical, warning, info).
 *  - classifyUrgency():        Based on how far below reorder level:
 *                              ≤ 0 on hand → critical
 *                              ≤ 50% of reorder_level → warning
 *                              else → info
 *
 * Zero-dependency. Works with the in-memory db.
 */

import crypto from "node:crypto";

// ── Urgency classification ──────────────────────────────────────────

export function classifyUrgency(quantityOnHand, reorderLevel) {
  if (quantityOnHand <= 0) return "critical";
  if (reorderLevel > 0 && quantityOnHand <= reorderLevel * 0.5) return "warning";
  return "info";
}

// ── Core: Scan & Generate ───────────────────────────────────────────

/**
 * Scans inventory items and generates alerts for low-stock items.
 * Deduplicates: won't create a new alert if an open alert already
 * exists for the same item_id.
 *
 * @returns {{ created: number, skippedDuplicate: number, totalLowStock: number }}
 */
export function scanAndGenerateAlerts({ store, db }) {
  if (!db.reorder_alerts) db.reorder_alerts = [];
  const items = db.stock_items || [];
  const suppliers = db.suppliers || [];

  // Set of item IDs with existing open alerts
  const openAlertItems = new Set(
    db.reorder_alerts
      .filter(a => a.status === "open")
      .map(a => a.item_id)
  );

  let created = 0;
  let skippedDuplicate = 0;
  let totalLowStock = 0;

  for (const item of items) {
    const reorderLevel = item.reorder_level ?? 0;
    if (reorderLevel <= 0) continue;  // No reorder level configured

    const onHand = item.quantity_on_hand ?? 0;
    if (onHand > reorderLevel) continue;  // Stock OK

    totalLowStock++;

    // Skip if open alert already exists for this item
    if (openAlertItems.has(item.id)) {
      skippedDuplicate++;
      continue;
    }

    const supplier = suppliers.find(s => s.id === item.supplier_id);
    const urgency = classifyUrgency(onHand, reorderLevel);

    const alert = {
      id: `ra_${crypto.randomBytes(8).toString("hex")}`,
      item_id: item.id,
      item_code: item.item_code || null,
      item_name: item.item_name || item.name || null,
      quantity_on_hand: onHand,
      reorder_level: reorderLevel,
      deficit: reorderLevel - onHand,
      unit_of_measure: item.unit_of_measure || null,
      supplier_id: item.supplier_id || null,
      supplier_name: supplier ? (supplier.name || supplier.company_name || null) : null,
      lead_time_days: supplier ? (supplier.lead_time_days || null) : null,
      urgency,
      status: "open",
      acknowledged_by: null,
      acknowledged_at: null,
      dismissed_by: null,
      dismissed_at: null,
      created_at: new Date().toISOString()
    };

    db.reorder_alerts.push(alert);
    openAlertItems.add(item.id);
    created++;

    if (store && store.audit) {
      store.audit(db, { id: "system" }, "reorder_alerts", alert.id,
        "REORDER_ALERT_CREATED", null, {
          item_id: item.id, item_code: item.item_code,
          quantity_on_hand: onHand, reorder_level: reorderLevel,
          urgency
        });
    }
  }

  return { created, skippedDuplicate, totalLowStock };
}

// ── Read ────────────────────────────────────────────────────────────

/**
 * Returns all open (unacknowledged, undismissed) alerts,
 * sorted by urgency: critical first, then warning, then info.
 */
export function getOpenAlerts({ db }) {
  const alerts = (db.reorder_alerts || []).filter(a => a.status === "open");
  const urgencyOrder = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) =>
    (urgencyOrder[a.urgency] ?? 3) - (urgencyOrder[b.urgency] ?? 3)
  );
}

/**
 * Returns all alerts (including acknowledged/dismissed), optionally filtered.
 */
export function listAlerts({ status, itemId, db }) {
  let alerts = db.reorder_alerts || [];
  if (status) alerts = alerts.filter(a => a.status === status);
  if (itemId) alerts = alerts.filter(a => a.item_id === itemId);
  return alerts.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

// ── Acknowledge / Dismiss ───────────────────────────────────────────

function findAlert(alertId, db) {
  const alert = (db.reorder_alerts || []).find(a => a.id === alertId);
  if (!alert) throw Object.assign(new Error("Reorder alert not found"), { status: 404 });
  return alert;
}

/**
 * Marks an alert as acknowledged (e.g. PO has been raised).
 */
export function acknowledgeAlert({ alertId, userId, store, db }) {
  const alert = findAlert(alertId, db);
  if (alert.status !== "open") {
    throw Object.assign(new Error(`Cannot acknowledge a ${alert.status} alert`), { status: 409 });
  }

  alert.status = "acknowledged";
  alert.acknowledged_by = userId;
  alert.acknowledged_at = new Date().toISOString();

  if (store && store.audit) {
    store.audit(db, { id: userId }, "reorder_alerts", alert.id,
      "REORDER_ALERT_ACKNOWLEDGED", { status: "open" }, { status: "acknowledged" });
  }

  return alert;
}

/**
 * Dismisses an alert (false positive or manual override).
 */
export function dismissAlert({ alertId, userId, reason, store, db }) {
  const alert = findAlert(alertId, db);
  if (alert.status !== "open") {
    throw Object.assign(new Error(`Cannot dismiss a ${alert.status} alert`), { status: 409 });
  }

  alert.status = "dismissed";
  alert.dismissed_by = userId;
  alert.dismissed_at = new Date().toISOString();
  alert.dismiss_reason = reason || null;

  if (store && store.audit) {
    store.audit(db, { id: userId }, "reorder_alerts", alert.id,
      "REORDER_ALERT_DISMISSED", { status: "open" }, { status: "dismissed", reason });
  }

  return alert;
}

// ── Dashboard Summary ───────────────────────────────────────────────

/**
 * Returns a dashboard summary of open alerts by urgency.
 */
export function getAlertSummary({ db }) {
  const open = getOpenAlerts({ db });
  return {
    total: open.length,
    critical: open.filter(a => a.urgency === "critical").length,
    warning:  open.filter(a => a.urgency === "warning").length,
    info:     open.filter(a => a.urgency === "info").length,
    items: open.map(a => ({
      id: a.id,
      item_code: a.item_code,
      item_name: a.item_name,
      quantity_on_hand: a.quantity_on_hand,
      reorder_level: a.reorder_level,
      deficit: a.deficit,
      urgency: a.urgency,
      supplier_name: a.supplier_name
    }))
  };
}
