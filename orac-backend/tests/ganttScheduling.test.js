/**
 * Tests for Gantt Scheduling Service.
 *
 * Tests:
 *  - buildGanttTimeline: resource grouping, bar generation, date filtering,
 *    unassigned lane, technician filter, range calculation
 *  - getResourceUtilisation: scheduled days, utilisation %, over-commitment
 *  - detectSchedulingConflicts: overlap detection, no false positives
 *  - rescheduleDispatch: date update, audit, validation, edge cases
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildGanttTimeline,
  getResourceUtilisation,
  detectSchedulingConflicts,
  rescheduleDispatch
} from "../src/services/ganttSchedulingService.js";

// ── Helpers ─────────────────────────────────────────────────────────

function makeDb(overrides = {}) {
  return {
    users: [
      { id: "tech-1", name: "John Mpofu",    role: "Technician", trade: "Rubber Lining", is_active: true },
      { id: "tech-2", name: "Peter Ncube",    role: "Technician", trade: "Conveyor Splicing", is_active: true },
      { id: "tech-3", name: "Grace Moyo",     role: "Technician", trade: "Pump Repair", is_active: true },
      { id: "mgr-1",  name: "Brian Manager",  role: "Management", is_active: true }
    ],
    dispatch_cards: [
      {
        id: "d-1", site_name: "Mimosa Mine - Mill 2", status: "WIP",
        scheduled_start: "2026-12-01", estimated_duration_days: 5,
        assigned_technician_id: "tech-1", assigned_technician_ids: ["tech-1", "tech-2"],
        client_id: "c-1", quotation_id: "q-1"
      },
      {
        id: "d-2", site_name: "Unki Mine - Crusher", status: "Scheduled",
        scheduled_start: "2026-12-08", scheduled_end: "2026-12-12",
        assigned_technician_id: "tech-2",
        client_id: "c-2"
      },
      {
        id: "d-3", site_name: "Ngezi Mine - Pump Station", status: "Draft",
        scheduled_start: "2026-12-15", estimated_duration_days: 3,
        // No technician assigned
        client_id: "c-1"
      }
    ],
    quotations: [
      { id: "q-1", quote_number: "QR-2026-0042", client_id: "c-1" }
    ],
    clients: [
      { id: "c-1", name: "Anglo American Platinum" },
      { id: "c-2", name: "Zimplats Holdings" }
    ],
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
// buildGanttTimeline
// ═════════════════════════════════════════════════════════════════════

describe("ganttSchedulingService — buildGanttTimeline", () => {
  it("returns resources and bars for all dispatches", () => {
    const db = makeDb();
    const result = buildGanttTimeline({ db });

    assert.ok(result.resources.length >= 2, "should have at least 2 resources (techs + unassigned)");
    assert.ok(result.bars.length >= 3, "should have bars for all dispatches");
    assert.ok(result.range.earliest, "should have earliest date");
    assert.ok(result.range.latest, "should have latest date");
  });

  it("groups dispatch bars by technician", () => {
    const db = makeDb();
    const result = buildGanttTimeline({ db });

    // d-1 is assigned to tech-1 and tech-2, so 2 bars for d-1
    const d1Bars = result.bars.filter(b => b.dispatchId === "d-1");
    assert.equal(d1Bars.length, 2, "d-1 should have 2 bars (one per technician)");
    assert.ok(d1Bars.some(b => b.resourceId === "tech-1"));
    assert.ok(d1Bars.some(b => b.resourceId === "tech-2"));
  });

  it("puts unassigned dispatches in __unassigned__ lane", () => {
    const db = makeDb();
    const result = buildGanttTimeline({ db });

    const unassigned = result.bars.filter(b => b.resourceId === "__unassigned__");
    assert.equal(unassigned.length, 1, "d-3 has no technician, should be unassigned");
    assert.equal(unassigned[0].dispatchId, "d-3");

    // Resources should include the Unassigned lane
    const unassignedResource = result.resources.find(r => r.id === "__unassigned__");
    assert.ok(unassignedResource, "should have unassigned resource");
    assert.equal(unassignedResource.type, "unassigned");
  });

  it("includes status colour on each bar", () => {
    const db = makeDb();
    const result = buildGanttTimeline({ db });

    for (const bar of result.bars) {
      assert.ok(bar.colour, `bar ${bar.id} should have a colour`);
      assert.ok(bar.colour.startsWith("#"), "colour should be a hex string");
    }

    // WIP should be green
    const wipBar = result.bars.find(b => b.status === "WIP");
    assert.equal(wipBar.colour, "#66bb6a");
  });

  it("filters by date range", () => {
    const db = makeDb();
    // Only dispatches in Dec 1-7 range
    const result = buildGanttTimeline({ startDate: "2026-12-01", endDate: "2026-12-07", db });

    // Only d-1 falls in this range (Dec 1-6)
    const dispatchIds = [...new Set(result.bars.map(b => b.dispatchId))];
    assert.ok(dispatchIds.includes("d-1"), "d-1 should be in range");
    assert.ok(!dispatchIds.includes("d-2"), "d-2 starts Dec 8, should be excluded");
    assert.ok(!dispatchIds.includes("d-3"), "d-3 starts Dec 15, should be excluded");
  });

  it("filters by technician", () => {
    const db = makeDb();
    const result = buildGanttTimeline({ technicianId: "tech-2", db });

    // tech-2 is on d-1 and d-2, not d-3
    for (const bar of result.bars) {
      assert.equal(bar.resourceId, "tech-2", "all bars should be for tech-2");
    }
    assert.ok(result.bars.length >= 2);
  });

  it("includes quote and client info on bars", () => {
    const db = makeDb();
    const result = buildGanttTimeline({ db });

    const d1Bar = result.bars.find(b => b.dispatchId === "d-1");
    assert.equal(d1Bar.quotationRef, "QR-2026-0042");
    assert.equal(d1Bar.client, "Anglo American Platinum");
  });

  it("calculates days from scheduled_start to inferred end", () => {
    const db = makeDb();
    const result = buildGanttTimeline({ db });

    // d-1: start Dec 1, duration 5 days → end Dec 6
    const d1Bar = result.bars.find(b => b.dispatchId === "d-1");
    assert.equal(d1Bar.start, "2026-12-01");
    assert.equal(d1Bar.end, "2026-12-06");
    assert.equal(d1Bar.days, 5);
  });

  it("uses explicit scheduled_end when available", () => {
    const db = makeDb();
    const result = buildGanttTimeline({ db });

    // d-2: explicit scheduled_end Dec 12
    const d2Bar = result.bars.find(b => b.dispatchId === "d-2");
    assert.equal(d2Bar.end, "2026-12-12");
  });

  it("skips dispatches without scheduled_start", () => {
    const db = makeDb({
      dispatch_cards: [
        ...makeDb().dispatch_cards,
        { id: "d-nosched", site_name: "No Schedule", assigned_technician_id: "tech-1" }
      ]
    });
    const result = buildGanttTimeline({ db });
    assert.ok(!result.bars.some(b => b.dispatchId === "d-nosched"));
  });

  it("handles empty dispatch_cards", () => {
    const db = makeDb({ dispatch_cards: [] });
    const result = buildGanttTimeline({ db });
    assert.deepEqual(result.resources, []);
    assert.deepEqual(result.bars, []);
    assert.equal(result.range.earliest, null);
    assert.equal(result.range.latest, null);
  });
});

// ═════════════════════════════════════════════════════════════════════
// getResourceUtilisation
// ═════════════════════════════════════════════════════════════════════

describe("ganttSchedulingService — getResourceUtilisation", () => {
  it("calculates utilisation percentage per technician", () => {
    const db = makeDb();
    const result = getResourceUtilisation({
      startDate: "2026-12-01", endDate: "2026-12-31", db
    });

    assert.ok(result.length >= 2, "should have stats for assigned technicians");
    for (const stat of result) {
      assert.ok(stat.technicianId);
      assert.ok(typeof stat.utilisation === "number");
      assert.ok(stat.utilisation >= 0 && stat.utilisation <= 200);
      assert.ok(typeof stat.scheduledDays === "number");
    }
  });

  it("flags over-committed technicians", () => {
    // tech-2 has d-1 (Dec 1-6) and d-2 (Dec 8-12) — no overlap
    // Let's create overlapping dispatches
    const db = makeDb({
      dispatch_cards: [
        {
          id: "d-overlap-1", site_name: "Job A", status: "WIP",
          scheduled_start: "2026-12-01", scheduled_end: "2026-12-05",
          assigned_technician_id: "tech-1"
        },
        {
          id: "d-overlap-2", site_name: "Job B", status: "Scheduled",
          scheduled_start: "2026-12-03", scheduled_end: "2026-12-07",
          assigned_technician_id: "tech-1"
        }
      ]
    });

    const result = getResourceUtilisation({
      startDate: "2026-12-01", endDate: "2026-12-31", db
    });

    const tech1 = result.find(r => r.technicianId === "tech-1");
    assert.ok(tech1, "tech-1 should be in results");
    assert.equal(tech1.overCommitted, true, "tech-1 should be over-committed");
  });

  it("requires startDate and endDate", () => {
    const db = makeDb();
    assert.throws(
      () => getResourceUtilisation({ db }),
      /startDate and endDate are required/
    );
  });

  it("excludes cancelled dispatches", () => {
    const db = makeDb({
      dispatch_cards: [
        {
          id: "d-cancelled", site_name: "Cancelled Job", status: "Cancelled",
          scheduled_start: "2026-12-01", scheduled_end: "2026-12-05",
          assigned_technician_id: "tech-3"
        }
      ]
    });

    const result = getResourceUtilisation({
      startDate: "2026-12-01", endDate: "2026-12-31", db
    });

    const tech3 = result.find(r => r.technicianId === "tech-3");
    assert.ok(!tech3, "tech-3 should not appear — only cancelled dispatches");
  });
});

// ═════════════════════════════════════════════════════════════════════
// detectSchedulingConflicts
// ═════════════════════════════════════════════════════════════════════

describe("ganttSchedulingService — detectSchedulingConflicts", () => {
  it("detects overlapping dispatch assignments", () => {
    const db = makeDb({
      dispatch_cards: [
        {
          id: "d-a", site_name: "Site A", status: "WIP",
          scheduled_start: "2026-12-01", scheduled_end: "2026-12-05",
          assigned_technician_id: "tech-1"
        },
        {
          id: "d-b", site_name: "Site B", status: "Scheduled",
          scheduled_start: "2026-12-03", scheduled_end: "2026-12-08",
          assigned_technician_id: "tech-1"
        }
      ]
    });

    const conflicts = detectSchedulingConflicts({ db });
    assert.equal(conflicts.length, 1, "should detect 1 conflict");
    assert.equal(conflicts[0].technicianId, "tech-1");
    assert.equal(conflicts[0].dispatch1.id, "d-a");
    assert.equal(conflicts[0].dispatch2.id, "d-b");
  });

  it("returns empty when no overlaps exist", () => {
    const db = makeDb({
      dispatch_cards: [
        {
          id: "d-x", site_name: "Site X", status: "WIP",
          scheduled_start: "2026-12-01", scheduled_end: "2026-12-05",
          assigned_technician_id: "tech-1"
        },
        {
          id: "d-y", site_name: "Site Y", status: "Scheduled",
          scheduled_start: "2026-12-10", scheduled_end: "2026-12-15",
          assigned_technician_id: "tech-1"
        }
      ]
    });

    const conflicts = detectSchedulingConflicts({ db });
    assert.equal(conflicts.length, 0);
  });

  it("ignores cancelled dispatches in conflict detection", () => {
    const db = makeDb({
      dispatch_cards: [
        {
          id: "d-active", site_name: "Active Job", status: "WIP",
          scheduled_start: "2026-12-01", scheduled_end: "2026-12-10",
          assigned_technician_id: "tech-1"
        },
        {
          id: "d-cancelled", site_name: "Cancelled Job", status: "Cancelled",
          scheduled_start: "2026-12-05", scheduled_end: "2026-12-15",
          assigned_technician_id: "tech-1"
        }
      ]
    });

    const conflicts = detectSchedulingConflicts({ db });
    assert.equal(conflicts.length, 0, "cancelled dispatches should not trigger conflicts");
  });

  it("includes technician name in conflict data", () => {
    const db = makeDb({
      dispatch_cards: [
        {
          id: "d-1", status: "WIP",
          scheduled_start: "2026-12-01", scheduled_end: "2026-12-05",
          assigned_technician_id: "tech-1"
        },
        {
          id: "d-2", status: "Scheduled",
          scheduled_start: "2026-12-03", scheduled_end: "2026-12-08",
          assigned_technician_id: "tech-1"
        }
      ]
    });

    const conflicts = detectSchedulingConflicts({ db });
    assert.equal(conflicts[0].technicianName, "John Mpofu");
  });
});

// ═════════════════════════════════════════════════════════════════════
// rescheduleDispatch
// ═════════════════════════════════════════════════════════════════════

describe("ganttSchedulingService — rescheduleDispatch", () => {
  it("updates scheduled dates and creates audit entry", () => {
    const db = makeDb();
    const store = makeStore();

    const updated = rescheduleDispatch({
      dispatchId: "d-1", newStart: "2026-12-10", newEnd: "2026-12-15",
      userId: "mgr-1", store, db
    });

    assert.equal(updated.scheduled_start, "2026-12-10");
    assert.equal(updated.scheduled_end, "2026-12-15");
    assert.ok(updated.updated_at);
    assert.equal(store._auditLog.length, 1);
    assert.equal(store._auditLog[0].action, "DISPATCH_RESCHEDULED");
  });

  it("auto-calculates end from estimated_duration_days when newEnd not given", () => {
    const db = makeDb();
    const store = makeStore();

    // d-1 has estimated_duration_days: 5
    const updated = rescheduleDispatch({
      dispatchId: "d-1", newStart: "2026-12-20",
      userId: "mgr-1", store, db
    });

    assert.equal(updated.scheduled_start, "2026-12-20");
    assert.equal(updated.scheduled_end, "2026-12-25");
  });

  it("throws 404 for unknown dispatch", () => {
    const db = makeDb();
    const store = makeStore();

    assert.throws(
      () => rescheduleDispatch({ dispatchId: "d-999", newStart: "2026-12-10", store, db }),
      /Dispatch card not found/
    );
  });

  it("throws 400 when newEnd is before newStart", () => {
    const db = makeDb();
    const store = makeStore();

    assert.throws(
      () => rescheduleDispatch({
        dispatchId: "d-1", newStart: "2026-12-15", newEnd: "2026-12-10", store, db
      }),
      /newEnd must be on or after newStart/
    );
  });

  it("throws 400 for missing dispatchId", () => {
    const db = makeDb();
    assert.throws(
      () => rescheduleDispatch({ newStart: "2026-12-10", db }),
      /dispatchId is required/
    );
  });

  it("throws 400 for missing newStart", () => {
    const db = makeDb();
    assert.throws(
      () => rescheduleDispatch({ dispatchId: "d-1", db }),
      /newStart is required/
    );
  });
});
