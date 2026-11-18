/**
 * Tests for Reorder Alert Service.
 *
 * Tests cover:
 *  - classifyUrgency: critical/warning/info thresholds
 *  - scanAndGenerateAlerts: creation, deduplication, skipping unconfigured items
 *  - getOpenAlerts: filtering and sort order
 *  - acknowledgeAlert / dismissAlert: state transitions, error handling
 *  - getAlertSummary: dashboard counts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classifyUrgency,
  scanAndGenerateAlerts,
  getOpenAlerts,
  listAlerts,
  acknowledgeAlert,
  dismissAlert,
  getAlertSummary
} from "../src/services/reorderAlertService.js";

// ── Helpers ─────────────────────────────────────────────────────────

function makeDb(overrides = {}) {
  return {
    stock_items: [
      { id: "si-1", item_code: "RL-SHEET-6", item_name: "Rubber Sheet 6mm",
        quantity_on_hand: 2, reorder_level: 10, unit_of_measure: "m²",
        supplier_id: "sup-1" },
      { id: "si-2", item_code: "CONV-BELT-800", item_name: "Conveyor Belt 800mm",
        quantity_on_hand: 0, reorder_level: 5, unit_of_measure: "m",
        supplier_id: "sup-2" },
      { id: "si-3", item_code: "PUMP-SEAL-100", item_name: "Pump Seal 100mm",
        quantity_on_hand: 50, reorder_level: 20, unit_of_measure: "pcs" },
      { id: "si-4", item_code: "BOLT-M12", item_name: "M12 Bolt",
        quantity_on_hand: 8, reorder_level: 10, unit_of_measure: "pcs",
        supplier_id: "sup-1" },
      { id: "si-5", item_code: "GLUE-COLD", item_name: "Cold Vulcanising Cement",
        quantity_on_hand: 3, reorder_level: 0, unit_of_measure: "litres" }
    ],
    suppliers: [
      { id: "sup-1", name: "RSA Rubber Supplies", lead_time_days: 14 },
      { id: "sup-2", name: "Belting SA", lead_time_days: 21 }
    ],
    reorder_alerts: [],
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
// classifyUrgency
// ═════════════════════════════════════════════════════════════════════

describe("reorderAlertService — classifyUrgency", () => {
  it("returns critical when quantity is 0", () => {
    assert.equal(classifyUrgency(0, 10), "critical");
  });

  it("returns critical when quantity is negative", () => {
    assert.equal(classifyUrgency(-5, 10), "critical");
  });

  it("returns warning when quantity is ≤ 50% of reorder level", () => {
    assert.equal(classifyUrgency(4, 10), "warning");
    assert.equal(classifyUrgency(5, 10), "warning");
  });

  it("returns info when quantity is above 50% of reorder level", () => {
    assert.equal(classifyUrgency(8, 10), "info");
  });

  it("returns critical for zero quantity even with zero reorder level", () => {
    assert.equal(classifyUrgency(0, 0), "critical");
  });
});

// ═════════════════════════════════════════════════════════════════════
// scanAndGenerateAlerts
// ═════════════════════════════════════════════════════════════════════

describe("reorderAlertService — scanAndGenerateAlerts", () => {
  it("creates alerts for items at or below reorder level", () => {
    const db = makeDb();
    const store = makeStore();
    const result = scanAndGenerateAlerts({ store, db });

    // si-1 (2 ≤ 10), si-2 (0 ≤ 5), si-4 (8 ≤ 10) → 3 low stock items
    // si-3 is above (50 > 20), si-5 has reorder_level: 0 (skipped)
    assert.equal(result.totalLowStock, 3);
    assert.equal(result.created, 3);
    assert.equal(result.skippedDuplicate, 0);
    assert.equal(db.reorder_alerts.length, 3);
  });

  it("includes correct item details in alert", () => {
    const db = makeDb();
    const store = makeStore();
    scanAndGenerateAlerts({ store, db });

    const si1Alert = db.reorder_alerts.find(a => a.item_id === "si-1");
    assert.ok(si1Alert);
    assert.equal(si1Alert.item_code, "RL-SHEET-6");
    assert.equal(si1Alert.item_name, "Rubber Sheet 6mm");
    assert.equal(si1Alert.quantity_on_hand, 2);
    assert.equal(si1Alert.reorder_level, 10);
    assert.equal(si1Alert.deficit, 8);
    assert.equal(si1Alert.supplier_name, "RSA Rubber Supplies");
    assert.equal(si1Alert.lead_time_days, 14);
    assert.equal(si1Alert.status, "open");
    assert.ok(si1Alert.id.startsWith("ra_"));
  });

  it("assigns correct urgency levels", () => {
    const db = makeDb();
    scanAndGenerateAlerts({ db });

    const si1 = db.reorder_alerts.find(a => a.item_id === "si-1");
    const si2 = db.reorder_alerts.find(a => a.item_id === "si-2");
    const si4 = db.reorder_alerts.find(a => a.item_id === "si-4");

    assert.equal(si1.urgency, "warning");   // 2 is ≤ 50% of 10 = 5
    assert.equal(si2.urgency, "critical");  // 0 on hand
    assert.equal(si4.urgency, "info");      // 8 is > 50% of 10 = 5
  });

  it("deduplicates — does not create duplicate alert for same item", () => {
    const db = makeDb();
    const store = makeStore();

    // First scan
    const r1 = scanAndGenerateAlerts({ store, db });
    assert.equal(r1.created, 3);

    // Second scan — no new alerts
    const r2 = scanAndGenerateAlerts({ store, db });
    assert.equal(r2.created, 0);
    assert.equal(r2.skippedDuplicate, 3);
    assert.equal(db.reorder_alerts.length, 3);
  });

  it("creates new alert if previous was acknowledged", () => {
    const db = makeDb();
    const store = makeStore();

    scanAndGenerateAlerts({ store, db });
    // Acknowledge the si-1 alert
    const si1Alert = db.reorder_alerts.find(a => a.item_id === "si-1");
    acknowledgeAlert({ alertId: si1Alert.id, userId: "admin-1", store, db });

    // Rescan — si-1 should get a new alert since old one is acknowledged
    const r2 = scanAndGenerateAlerts({ store, db });
    assert.equal(r2.created, 1);  // only si-1 gets new alert
    assert.equal(db.reorder_alerts.length, 4);
  });

  it("skips items with reorder_level 0 or missing", () => {
    const db = makeDb();
    scanAndGenerateAlerts({ db });

    // si-5 has reorder_level: 0 → should not trigger alert
    assert.ok(!db.reorder_alerts.some(a => a.item_id === "si-5"));
  });

  it("skips items above reorder level", () => {
    const db = makeDb();
    scanAndGenerateAlerts({ db });

    // si-3 has 50 on hand, reorder level 20 → no alert
    assert.ok(!db.reorder_alerts.some(a => a.item_id === "si-3"));
  });

  it("creates audit entries", () => {
    const db = makeDb();
    const store = makeStore();
    scanAndGenerateAlerts({ store, db });

    assert.equal(store._auditLog.length, 3);
    assert.ok(store._auditLog.every(e => e.action === "REORDER_ALERT_CREATED"));
  });
});

// ═════════════════════════════════════════════════════════════════════
// getOpenAlerts
// ═════════════════════════════════════════════════════════════════════

describe("reorderAlertService — getOpenAlerts", () => {
  it("returns only open alerts sorted by urgency", () => {
    const db = makeDb();
    scanAndGenerateAlerts({ db });

    const open = getOpenAlerts({ db });
    assert.equal(open.length, 3);

    // critical first, then warning, then info
    assert.equal(open[0].urgency, "critical");
    assert.equal(open[1].urgency, "warning");
    assert.equal(open[2].urgency, "info");
  });

  it("excludes acknowledged and dismissed alerts", () => {
    const db = makeDb();
    const store = makeStore();
    scanAndGenerateAlerts({ store, db });

    // Acknowledge si-2 alert
    const si2 = db.reorder_alerts.find(a => a.item_id === "si-2");
    acknowledgeAlert({ alertId: si2.id, userId: "admin-1", store, db });

    const open = getOpenAlerts({ db });
    assert.equal(open.length, 2);
    assert.ok(!open.some(a => a.item_id === "si-2"));
  });
});

// ═════════════════════════════════════════════════════════════════════
// acknowledgeAlert / dismissAlert
// ═════════════════════════════════════════════════════════════════════

describe("reorderAlertService — acknowledgeAlert", () => {
  it("marks alert as acknowledged with user and timestamp", () => {
    const db = makeDb();
    const store = makeStore();
    scanAndGenerateAlerts({ store, db });

    const alert = db.reorder_alerts[0];
    const updated = acknowledgeAlert({ alertId: alert.id, userId: "admin-1", store, db });

    assert.equal(updated.status, "acknowledged");
    assert.equal(updated.acknowledged_by, "admin-1");
    assert.ok(updated.acknowledged_at);
  });

  it("throws 409 when acknowledging a non-open alert", () => {
    const db = makeDb();
    const store = makeStore();
    scanAndGenerateAlerts({ store, db });

    const alert = db.reorder_alerts[0];
    acknowledgeAlert({ alertId: alert.id, userId: "admin-1", store, db });

    // Try to acknowledge again
    assert.throws(
      () => acknowledgeAlert({ alertId: alert.id, userId: "admin-1", store, db }),
      /Cannot acknowledge/
    );
  });

  it("throws 404 for unknown alert ID", () => {
    const db = makeDb();
    assert.throws(
      () => acknowledgeAlert({ alertId: "ra_unknown", userId: "admin-1", db }),
      /not found/
    );
  });
});

describe("reorderAlertService — dismissAlert", () => {
  it("marks alert as dismissed with reason", () => {
    const db = makeDb();
    const store = makeStore();
    scanAndGenerateAlerts({ store, db });

    const alert = db.reorder_alerts[0];
    const updated = dismissAlert({
      alertId: alert.id, userId: "admin-1",
      reason: "Surplus stock in warehouse B", store, db
    });

    assert.equal(updated.status, "dismissed");
    assert.equal(updated.dismissed_by, "admin-1");
    assert.equal(updated.dismiss_reason, "Surplus stock in warehouse B");
    assert.ok(updated.dismissed_at);
  });

  it("throws 409 when dismissing a non-open alert", () => {
    const db = makeDb();
    const store = makeStore();
    scanAndGenerateAlerts({ store, db });

    const alert = db.reorder_alerts[0];
    dismissAlert({ alertId: alert.id, userId: "admin-1", store, db });

    assert.throws(
      () => dismissAlert({ alertId: alert.id, userId: "admin-1", store, db }),
      /Cannot dismiss/
    );
  });
});

// ═════════════════════════════════════════════════════════════════════
// listAlerts
// ═════════════════════════════════════════════════════════════════════

describe("reorderAlertService — listAlerts", () => {
  it("returns all alerts without filter", () => {
    const db = makeDb();
    const store = makeStore();
    scanAndGenerateAlerts({ store, db });

    const all = listAlerts({ db });
    assert.equal(all.length, 3);
  });

  it("filters by status", () => {
    const db = makeDb();
    const store = makeStore();
    scanAndGenerateAlerts({ store, db });

    acknowledgeAlert({ alertId: db.reorder_alerts[0].id, userId: "admin-1", store, db });

    assert.equal(listAlerts({ status: "open", db }).length, 2);
    assert.equal(listAlerts({ status: "acknowledged", db }).length, 1);
  });

  it("filters by itemId", () => {
    const db = makeDb();
    scanAndGenerateAlerts({ db });

    const filtered = listAlerts({ itemId: "si-1", db });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].item_id, "si-1");
  });
});

// ═════════════════════════════════════════════════════════════════════
// getAlertSummary
// ═════════════════════════════════════════════════════════════════════

describe("reorderAlertService — getAlertSummary", () => {
  it("returns counts by urgency", () => {
    const db = makeDb();
    scanAndGenerateAlerts({ db });

    const summary = getAlertSummary({ db });
    assert.equal(summary.total, 3);
    assert.equal(summary.critical, 1);  // si-2: 0 on hand
    assert.equal(summary.warning, 1);   // si-1: 2 on hand, reorder 10
    assert.equal(summary.info, 1);      // si-4: 8 on hand, reorder 10
    assert.equal(summary.items.length, 3);
  });

  it("returns empty summary when no alerts", () => {
    const db = makeDb({ stock_items: [], reorder_alerts: [] });
    const summary = getAlertSummary({ db });
    assert.equal(summary.total, 0);
    assert.equal(summary.critical, 0);
    assert.deepEqual(summary.items, []);
  });
});
