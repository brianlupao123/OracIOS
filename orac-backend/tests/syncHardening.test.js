// backend/tests/syncHardening.test.js
//
// Hardened Offline Sync Engine Acceptance & Regression Tests (Batch C Commit 1 - v4)
//
// Covers:
// - Hardening controls (S-01 through S-11):
//   * Explicit entity allow-list and refusal of unknown types
//   * Refusal of protected entities (timesheet, worksheet, etc.)
//   * Refusal of protected fields and disallowed fields
//   * Refusal of DELETE on business collections
//   * Per-operation permission enforcement via permissions.js
//   * Refused operations do not persist raw payload in journal
//   * Conflict resolution security gates
//   * Invariance: real dispatchController.createWorksheet creation and replay
//   * Reconciled ALLOWED_FIELDS for inspection and equipment_tag
//   * Entire mutation refused when any field is outside per-entity allowlist (including notes)
//   * Consistent active-user checks across all 3 routes
//   * Preserved getSyncJournal authorization: permits Admin, Management, Operations, Supervisor; denies Technician and HSE & Quality
//
// - Restored pre-existing behaviors regression tests (R-01 through R-06):
//   * R-01: Duplicate INSERT pushes record and increments committed_count
//   * R-02: UPDATE of missing record inserts record and increments committed_count
//   * R-03: Conflict status is CONFLICT_REVIEW with colliding_fields
//   * R-04: Successful journal fields include store.id("jrn"), timestamps, and payload
//   * R-05: resolveSyncConflict lookup by either client_mutation_id or journal ID, uses merged_payload and resolution_notes
//   * R-06: Response shape matches existing API contract { success, device_id, total_processed, committed_count, conflict_count, results }

import test from "node:test";
import assert from "node:assert/strict";

import {
  processBatchOfflineSync,
  resolveSyncConflict,
  ALLOWED_ENTITY_TYPES,
  PROTECTED_ENTITY_TYPES,
  PROTECTED_FIELDS,
  ALLOWED_FIELDS
} from "../src/services/offlineSyncService.js";

import {
  syncBatchMutations,
  getSyncJournal,
  resolveConflict
} from "../src/controllers/syncController.js";

import { createWorksheet } from "../src/controllers/dispatchController.js";
import { BatchSyncSchema, ResolveConflictSchema } from "../src/schemas.js";

function createMockStore() {
  let counter = 0;
  const audits = [];
  return {
    id: (prefix) => `${prefix}_${++counter}`,
    audit: (db, actor, entity, entityId, action, before, after) => {
      audits.push({ actor, entity, entityId, action, before, after });
    },
    audits
  };
}

// ── HARDENING ACCEPTANCE TESTS (S-01 to S-11) ────────────────────────────────

// S-01: Unknown entity_type is refused
test("S-01: Unknown entity_type is refused (at schema layer and service layer)", () => {
  const schemaResult = BatchSyncSchema.safeParse({
    client_device_id: "TAB-01",
    mutations: [
      {
        client_mutation_id: "mut-unknown",
        entity_type: "unknown_entity_type",
        entity_id: "ent-1",
        operation: "INSERT",
        client_timestamp: "2026-11-20T08:00:00Z",
        payload: { some_field: "value" }
      }
    ]
  });
  assert.equal(schemaResult.success, false, "BatchSyncSchema enum must reject unknown entity types");

  const db = { offline_sync_journal: [] };
  const store = createMockStore();
  const actor = { id: "u-admin", role: "Admin", is_active: true };

  const summary = processBatchOfflineSync(db, store, actor, "TAB-01", [
    {
      client_mutation_id: "mut-unknown-svc",
      entity_type: "unrecognized_widget",
      entity_id: "ent-2",
      operation: "INSERT",
      client_timestamp: "2026-11-20T08:00:00Z",
      payload: { some_field: "value" }
    }
  ]);

  assert.equal(summary.committed_count, 0);
  assert.equal(summary.results[0].status, "REFUSED");
  assert.match(summary.results[0].refusal_reason, /not permitted for generic offline sync/);
});

// S-02: Protected entity mutations refused
test("S-02: Protected entity mutations (timesheet, worksheet) are refused", () => {
  const db = {
    timesheets: [],
    field_worksheets: [],
    offline_sync_journal: []
  };
  const store = createMockStore();
  const actor = { id: "u-admin", role: "Admin", is_active: true };

  const summary = processBatchOfflineSync(db, store, actor, "TAB-01", [
    {
      client_mutation_id: "mut-ts-01",
      entity_type: "timesheet",
      entity_id: "ts-001",
      operation: "INSERT",
      client_timestamp: "2026-11-20T08:00:00Z",
      payload: { normal_hours: 8, status: "Submitted" }
    },
    {
      client_mutation_id: "mut-ws-01",
      entity_type: "worksheet",
      entity_id: "ws-001",
      operation: "INSERT",
      client_timestamp: "2026-11-20T08:00:00Z",
      payload: { activity: "Mechanical maintenance", hours: 4 }
    }
  ]);

  assert.equal(summary.committed_count, 0);
  assert.equal(summary.results[0].status, "REFUSED");
  assert.equal(summary.results[1].status, "REFUSED");
  assert.match(summary.results[0].refusal_reason, /Protected entity type/);
  assert.match(summary.results[1].refusal_reason, /Protected entity type/);
  assert.equal(db.timesheets.length, 0);
  assert.equal(db.field_worksheets.length, 0);
});

// S-03: Protected fields refused
test("S-03: Mutations attempting to set protected fields are refused", () => {
  const db = {
    equipment_tags: [{ id: "eq-001", tag_code: "PMP-001", plant_section_id: "sec-1", equipment_name: "Slurry Pump", criticality: "high", status: "active" }],
    offline_sync_journal: []
  };
  const store = createMockStore();
  const actor = { id: "u-admin", role: "Admin", is_active: true };

  const summary = processBatchOfflineSync(db, store, actor, "TAB-01", [
    {
      client_mutation_id: "mut-protected-rate",
      entity_type: "equipment_tag",
      entity_id: "eq-001",
      operation: "UPDATE",
      client_timestamp: "2026-11-20T08:00:00Z",
      payload: { hourly_rate: 150 }
    },
    {
      client_mutation_id: "mut-protected-ack",
      entity_type: "equipment_tag",
      entity_id: "eq-001",
      operation: "UPDATE",
      client_timestamp: "2026-11-20T08:00:00Z",
      payload: { client_acknowledgement: { acknowledged_by: "Client User" } }
    },
    {
      client_mutation_id: "mut-protected-id",
      entity_type: "equipment_tag",
      entity_id: "eq-001",
      operation: "UPDATE",
      client_timestamp: "2026-11-20T08:00:00Z",
      payload: { id: "eq-override" }
    }
  ]);

  assert.equal(summary.committed_count, 0);
  assert.match(summary.results[0].refusal_reason, /Field 'hourly_rate' is protected/);
  assert.match(summary.results[1].refusal_reason, /Field 'client_acknowledgement' is protected/);
  assert.match(summary.results[2].refusal_reason, /Field 'id' is protected/);
});

// S-04: DELETE refused on business collections
test("S-04: DELETE operations are refused on business collections", () => {
  const db = {
    equipment_tags: [{ id: "eq-001", tag_code: "PMP-001", plant_section_id: "sec-1", equipment_name: "Slurry Pump", criticality: "high", status: "active" }],
    offline_sync_journal: []
  };
  const store = createMockStore();
  const actor = { id: "u-admin", role: "Admin", is_active: true };

  const summary = processBatchOfflineSync(db, store, actor, "TAB-01", [
    {
      client_mutation_id: "mut-del-01",
      entity_type: "equipment_tag",
      entity_id: "eq-001",
      operation: "DELETE",
      client_timestamp: "2026-11-20T08:00:00Z",
      payload: {}
    }
  ]);

  assert.equal(summary.committed_count, 0);
  assert.equal(summary.results[0].status, "REFUSED");
  assert.match(summary.results[0].refusal_reason, /DELETE operation is refused/);
  assert.equal(db.equipment_tags.length, 1, "Equipment tag must not be deleted");
});

// S-05: Per-operation permission enforcement
test("S-05: Per-operation permission enforcement refuses unauthorized mutations", () => {
  const db = {
    equipment_tags: [],
    pre_dispatch_ppe_checklists: [],
    offline_sync_journal: []
  };
  const store = createMockStore();

  // Technician lacks manageAssets (equipment_tag)
  const techActor = { id: "u-tech", role: "Technician", is_active: true };
  const summary1 = processBatchOfflineSync(db, store, techActor, "TAB-01", [
    {
      client_mutation_id: "mut-eq-tech",
      entity_type: "equipment_tag",
      entity_id: "eq-002",
      operation: "INSERT",
      client_timestamp: "2026-11-20T08:00:00Z",
      payload: { plant_section_id: "sec-1", tag_code: "PMP-002", equipment_name: "Pump B", criticality: "medium", status: "active" }
    }
  ]);

  assert.equal(summary1.committed_count, 0);
  assert.equal(summary1.results[0].status, "REFUSED");
  assert.match(summary1.results[0].refusal_reason, /lacks 'manageAssets'/);

  // Supervisor has managePpeChecklists (inspection)
  const supervisorActor = { id: "u-sup", role: "Supervisor", is_active: true };
  const summary2 = processBatchOfflineSync(db, store, supervisorActor, "TAB-01", [
    {
      client_mutation_id: "mut-insp-sup",
      entity_type: "inspection",
      entity_id: "ppe-001",
      operation: "INSERT",
      client_timestamp: "2026-11-20T08:00:00Z",
      payload: {
        dispatch_card_id: "disp-001",
        technician_id: "u-tech-1",
        technician_name: "Artisan Farai",
        site_location: "Shaft 3 North",
        hard_hat_pass: true,
        metatarsal_boots_pass: true,
        heavy_chemical_gloves_pass: true,
        safety_glasses_pass: true,
        high_vis_vest_pass: true,
        respirator_mask_pass: true,
        ear_protection_pass: true,
        fall_arrest_harness_pass: true
      }
    }
  ]);

  assert.equal(summary2.committed_count, 1);
  assert.equal(summary2.results[0].status, "COMMITTED");
});

// S-06: Refused batch items do not persist payload in journal
test("S-06: Refused operations are recorded in journal without raw payload", () => {
  const db = { offline_sync_journal: [] };
  const store = createMockStore();
  const actor = { id: "u-admin", role: "Admin", is_active: true };

  const sensitivePayload = {
    hourly_rate: 250,
    client_acknowledgement: "Tampered Signature",
    secret_note: "Do not leak"
  };

  processBatchOfflineSync(db, store, actor, "TAB-01", [
    {
      client_mutation_id: "mut-sensitive-refusal",
      entity_type: "equipment_tag",
      entity_id: "eq-001",
      operation: "UPDATE",
      client_timestamp: "2026-11-20T08:00:00Z",
      payload: sensitivePayload
    }
  ]);

  assert.equal(db.offline_sync_journal.length, 1);
  const entry = db.offline_sync_journal[0];
  assert.equal(entry.sync_status, "REFUSED");
  assert.equal(entry.payload, undefined, "Refused journal entry must not persist payload");
  assert.equal(JSON.stringify(entry).includes("Tampered Signature"), false);
});

// S-07: Conflict resolution refuses protected fields/entities
test("S-07: Conflict resolution refuses protected fields and protected entities", () => {
  const db = {
    equipment_tags: [{ id: "eq-001", tag_code: "PMP-001", plant_section_id: "sec-1", equipment_name: "Slurry Pump", criticality: "high", status: "active" }],
    offline_sync_journal: [
      {
        id: "sync_j_protected_entity",
        client_mutation_id: "mut-c1",
        entity_type: "timesheet",
        entity_id: "ts-001",
        sync_status: "CONFLICT_REVIEW",
        conflict_details: { client_payload: { normal_hours: 8 } },
        payload: { normal_hours: 8 }
      },
      {
        id: "sync_j_protected_field",
        client_mutation_id: "mut-c2",
        entity_type: "equipment_tag",
        entity_id: "eq-001",
        sync_status: "CONFLICT_REVIEW",
        conflict_details: { colliding_fields: [{ field: "criticality" }] },
        payload: { hourly_rate: 200 }
      }
    ]
  };
  const store = createMockStore();
  const actor = { id: "u-admin", role: "Admin", is_active: true };

  // Attempting to resolve conflict on protected entity type timesheet
  assert.throws(
    () => resolveSyncConflict(db, store, actor, "sync_j_protected_entity", { resolution_strategy: "ACCEPT_CLIENT", resolution_notes: "valid note" }),
    (err) => {
      assert.equal(err.statusCode, 403);
      assert.match(err.message, /Cannot resolve conflict on protected\/unknown entity type/);
      return true;
    }
  );

  // Attempting to write protected field via ACCEPT_CLIENT
  assert.throws(
    () => resolveSyncConflict(db, store, actor, "sync_j_protected_field", { resolution_strategy: "ACCEPT_CLIENT", resolution_notes: "valid note" }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /Field 'hourly_rate' is protected/);
      return true;
    }
  );

  // Attempting to write protected field via MERGE_MANUAL
  assert.throws(
    () => resolveSyncConflict(db, store, actor, "sync_j_protected_field", {
      resolution_strategy: "MERGE_MANUAL",
      merged_payload: { client_acknowledgement: "fake" },
      resolution_notes: "valid note"
    }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.match(err.message, /Field 'client_acknowledgement' is protected/);
      return true;
    }
  );
});

// S-08: Permitted existing offline Timesheet creation/replay via dispatchController.createWorksheet is unchanged
test("S-08: Permitted existing offline Timesheet creation and replay via dispatchController.createWorksheet is unchanged", () => {
  const db = {
    users: [
      { id: "u-admin", role: "Admin", name: "System Admin", is_active: true },
      { id: "u-tech", role: "Technician", name: "Artisan Farai", trade: "Boilermaker", is_active: true }
    ],
    clients: [{ id: "c-001", name: "Zimplats Mining" }],
    quotes: [{ id: "q-001", client_id: "c-001", status: "Field_Dispatch" }],
    dispatch_cards: [
      {
        id: "disp-001",
        quotation_id: "q-001",
        assigned_technician_ids: ["u-tech"],
        scheduled_start: "2026-11-20",
        scheduled_end: "2026-11-25"
      }
    ],
    field_worksheets: [],
    timesheets: [],
    audit_logs: []
  };

  const store = createMockStore();

  // 1. First offline submission with client_request_id creates the record
  const req1 = {
    user: { id: "u-admin" },
    db,
    store,
    params: { id: "disp-001" },
    body: {
      client_request_id: "req-offline-ts-100",
      technician_id: "u-tech",
      work_date: "2026-11-20",
      activity: "Conveyor chute liner replacement",
      hours: 8,
      hours_breakdown: { normal: 8, ot_15: 0, ot_20: 0 },
      tools_used: "Impact wrench, torque wrench",
      captured_offline_at: "2026-11-20T10:00:00Z"
    }
  };

  let statusCode1 = 200;
  let resData1 = null;
  const res1 = {
    status(code) { statusCode1 = code; return this; },
    json(data) { resData1 = data; return this; }
  };

  createWorksheet(req1, res1);

  assert.equal(statusCode1, 200);
  assert.equal(resData1.success, true);
  assert.ok(resData1.data?.id);
  assert.equal(resData1.data.client_request_id, "req-offline-ts-100");
  assert.equal(db.field_worksheets.length, 1);

  // 2. Offline replay: same client_request_id and payload returns original with replayed: true
  const req2 = {
    user: { id: "u-admin" },
    db,
    store,
    params: { id: "disp-001" },
    body: { ...req1.body }
  };

  let statusCode2 = 200;
  let resData2 = null;
  const res2 = {
    status(code) { statusCode2 = code; return this; },
    json(data) { resData2 = data; return this; }
  };

  createWorksheet(req2, res2);

  assert.equal(statusCode2, 200);
  assert.equal(resData2.success, true);
  assert.equal(resData2.replayed, true);
  assert.equal(resData2.data.id, resData1.data.id);
  assert.equal(db.field_worksheets.length, 1, "Replay must not duplicate worksheet records");

  // 3. In contrast, generic sync refuses timesheets
  const syncSummary = processBatchOfflineSync(db, store, { id: "u-admin", role: "Admin", is_active: true }, "DEV-01", [
    {
      client_mutation_id: "sync-ts-refuse",
      entity_type: "timesheet",
      entity_id: "ts-blocked",
      operation: "INSERT",
      client_timestamp: "2026-11-20T10:00:00Z",
      payload: { normal_hours: 8 }
    }
  ]);

  assert.equal(syncSummary.results[0].status, "REFUSED");
});

// S-09: Reconciled ALLOWED_FIELDS: legitimate payloads succeed, unapproved fields refuse the entire mutation
test("S-09: Reconciled ALLOWED_FIELDS: legitimate offline payloads succeed, unapproved fields refuse entire mutation", () => {
  const db = {
    equipment_tags: [],
    pre_dispatch_ppe_checklists: [],
    offline_sync_journal: []
  };
  const store = createMockStore();
  const adminActor = { id: "u-admin", role: "Admin", is_active: true };

  // 1. Legitimate equipment_tag payload matching AdminCreateEquipmentTagSchema
  const legitimateEquipment = {
    client_mutation_id: "mut-eq-legit",
    entity_type: "equipment_tag",
    entity_id: "eq-001",
    operation: "INSERT",
    client_timestamp: "2026-11-20T08:00:00Z",
    payload: {
      plant_section_id: "sec-01",
      tag_code: "PMP-001",
      equipment_name: "Slurry Feed Pump",
      criticality: "high",
      status: "active"
    }
  };

  // 2. Legitimate inspection payload matching PreDispatchPpeChecklistSchema
  const legitimateInspection = {
    client_mutation_id: "mut-insp-legit",
    entity_type: "inspection",
    entity_id: "ppe-001",
    operation: "INSERT",
    client_timestamp: "2026-11-20T08:15:00Z",
    payload: {
      dispatch_card_id: "disp-001",
      technician_id: "u-tech-1",
      technician_name: "Artisan Farai",
      site_location: "Shaft 3 North",
      hard_hat_pass: true,
      metatarsal_boots_pass: true,
      heavy_chemical_gloves_pass: true,
      safety_glasses_pass: true,
      high_vis_vest_pass: true,
      respirator_mask_pass: true,
      ear_protection_pass: true,
      fall_arrest_harness_pass: true
    }
  };

  // 3. equipment_tag with 'notes' field — not in AdminCreate/UpdateEquipmentTagSchema
  const notesFieldEquipment = {
    client_mutation_id: "mut-eq-notes",
    entity_type: "equipment_tag",
    entity_id: "eq-notes",
    operation: "INSERT",
    client_timestamp: "2026-11-20T08:25:00Z",
    payload: {
      plant_section_id: "sec-01",
      tag_code: "PMP-NOTES",
      equipment_name: "Notes Test Pump",
      criticality: "low",
      status: "active",
      notes: "This field is not in the schema"
    }
  };

  // 4. Equipment payload with invented field
  const inventedFieldEquipment = {
    client_mutation_id: "mut-eq-invented",
    entity_type: "equipment_tag",
    entity_id: "eq-002",
    operation: "INSERT",
    client_timestamp: "2026-11-20T08:30:00Z",
    payload: {
      plant_section_id: "sec-01",
      tag_code: "PMP-002",
      equipment_name: "Water Pump",
      criticality: "low",
      status: "active",
      invented_field: "not_in_schema"
    }
  };

  // 5. Inspection payload with invented field
  const inventedFieldInspection = {
    client_mutation_id: "mut-insp-invented",
    entity_type: "inspection",
    entity_id: "ppe-002",
    operation: "INSERT",
    client_timestamp: "2026-11-20T08:45:00Z",
    payload: {
      dispatch_card_id: "disp-001",
      technician_id: "u-tech-1",
      technician_name: "Artisan Farai",
      site_location: "Shaft 3 North",
      hard_hat_pass: true,
      metatarsal_boots_pass: true,
      heavy_chemical_gloves_pass: true,
      safety_glasses_pass: true,
      high_vis_vest_pass: true,
      respirator_mask_pass: true,
      ear_protection_pass: true,
      fall_arrest_harness_pass: true,
      unapproved_notes: "should be refused"
    }
  };

  const summary = processBatchOfflineSync(db, store, adminActor, "DEV-01", [
    legitimateEquipment,
    legitimateInspection,
    notesFieldEquipment,
    inventedFieldEquipment,
    inventedFieldInspection
  ]);

  assert.equal(summary.committed_count, 2, "Both legitimate payloads must be committed");
  assert.equal(summary.results[0].status, "COMMITTED");
  assert.equal(summary.results[1].status, "COMMITTED");

  // equipment_tag with 'notes' — entire mutation refused, no record created
  assert.equal(summary.results[2].status, "REFUSED");
  assert.match(summary.results[2].refusal_reason, /notes/);
  assert.match(summary.results[2].refusal_reason, /not permitted/);

  // equipment_tag with 'invented_field' — entire mutation refused
  assert.equal(summary.results[3].status, "REFUSED");
  assert.match(summary.results[3].refusal_reason, /invented_field/);

  // inspection with 'unapproved_notes' — entire mutation refused
  assert.equal(summary.results[4].status, "REFUSED");
  assert.match(summary.results[4].refusal_reason, /unapproved_notes/);

  // No records were created for the refused mutations
  assert.equal(db.equipment_tags.length, 1, "Only the legitimate equipment_tag record exists");
  assert.equal(db.pre_dispatch_ppe_checklists.length, 1, "Only the legitimate inspection record exists");
});

// S-10: Consistent active-user enforcement across batch sync, journal view, and conflict resolution
test("S-10: Consistent active-user enforcement across batch sync, journal view, and conflict resolution", () => {
  const db = {
    users: [
      { id: "u-inactive-admin", role: "Admin", name: "Deactivated Admin", is_active: false },
      { id: "u-active-admin", role: "Admin", name: "Active Admin", is_active: true }
    ],
    offline_sync_journal: []
  };

  // 1. Batch sync with inactive user -> 403 Forbidden
  const reqBatch = {
    user: { id: "u-inactive-admin" },
    db,
    body: {
      client_device_id: "DEV-01",
      mutations: [
        {
          client_mutation_id: "m-1",
          entity_type: "equipment_tag",
          entity_id: "eq-1",
          operation: "INSERT",
          client_timestamp: "2026-11-20T10:00:00Z",
          payload: { plant_section_id: "s1", tag_code: "T1", equipment_name: "Pump" }
        }
      ]
    }
  };
  let codeBatch = null;
  let bodyBatch = null;
  syncBatchMutations(reqBatch, {
    status(c) { codeBatch = c; return this; },
    json(b) { bodyBatch = b; return this; }
  });
  assert.equal(codeBatch, 403);
  assert.match(bodyBatch.message, /Inactive user/);

  // 2. Journal view with inactive user -> 403 Forbidden
  const reqJournal = {
    user: { id: "u-inactive-admin" },
    db,
    query: {}
  };
  let codeJournal = null;
  let bodyJournal = null;
  getSyncJournal(reqJournal, {
    status(c) { codeJournal = c; return this; },
    json(b) { bodyJournal = b; return this; }
  });
  assert.equal(codeJournal, 403);
  assert.match(bodyJournal.message, /Inactive user/);

  // 3. Conflict resolution with inactive user -> 403 Forbidden
  const reqConflict = {
    user: { id: "u-inactive-admin" },
    db,
    params: { id: "sync_j_1" },
    body: { resolution_strategy: "KEEP_SERVER", resolution_notes: "valid note" }
  };
  let codeConflict = null;
  let bodyConflict = null;
  resolveConflict(reqConflict, {
    status(c) { codeConflict = c; return this; },
    json(b) { bodyConflict = b; return this; }
  });
  assert.equal(codeConflict, 403);
  assert.match(bodyConflict.message, /Inactive user/);
});

// S-11: getSyncJournal preserves original role authorization: permits exactly Admin, Management, Operations, Supervisor; denies Technician and HSE & Quality
test("S-11: getSyncJournal permits Admin, Management, Operations, Supervisor and denies Technician and HSE & Quality", () => {
  const db = {
    users: [
      { id: "u-admin", role: "Admin", name: "Admin User", is_active: true },
      { id: "u-mgmt", role: "Management", name: "Manager", is_active: true },
      { id: "u-ops", role: "Operations", name: "Ops User", is_active: true },
      { id: "u-sup", role: "Supervisor", name: "Supervisor", is_active: true },
      { id: "u-tech", role: "Technician", name: "Technician", is_active: true },
      { id: "u-hse", role: "HSE & Quality", name: "HSE Officer", is_active: true }
    ],
    offline_sync_journal: []
  };

  // ── Permitted roles: Admin, Management, Operations, Supervisor ──

  // Admin → 200
  let codeAdmin = 200;
  let bodyAdmin = null;
  getSyncJournal({ user: { id: "u-admin" }, db, query: {} }, {
    status(c) { codeAdmin = c; return this; },
    json(b) { bodyAdmin = b; return this; }
  });
  assert.equal(codeAdmin, 200, "Admin must be permitted");
  assert.equal(bodyAdmin.success, true);

  // Management → 200
  let codeMgmt = 200;
  let bodyMgmt = null;
  getSyncJournal({ user: { id: "u-mgmt" }, db, query: {} }, {
    status(c) { codeMgmt = c; return this; },
    json(b) { bodyMgmt = b; return this; }
  });
  assert.equal(codeMgmt, 200, "Management must be permitted");
  assert.equal(bodyMgmt.success, true);

  // Operations → 200
  let codeOps = 200;
  let bodyOps = null;
  getSyncJournal({ user: { id: "u-ops" }, db, query: {} }, {
    status(c) { codeOps = c; return this; },
    json(b) { bodyOps = b; return this; }
  });
  assert.equal(codeOps, 200, "Operations must be permitted");
  assert.equal(bodyOps.success, true);

  // Supervisor → 200
  let codeSup = 200;
  let bodySup = null;
  getSyncJournal({ user: { id: "u-sup" }, db, query: {} }, {
    status(c) { codeSup = c; return this; },
    json(b) { bodySup = b; return this; }
  });
  assert.equal(codeSup, 200, "Supervisor must be permitted");
  assert.equal(bodySup.success, true);

  // ── Denied roles: Technician and HSE & Quality ──

  // Technician → 403
  let codeTech = null;
  let bodyTech = null;
  getSyncJournal({ user: { id: "u-tech" }, db, query: {} }, {
    status(c) { codeTech = c; return this; },
    json(b) { bodyTech = b; return this; }
  });
  assert.equal(codeTech, 403, "Technician must be denied");
  assert.match(bodyTech.message, /lacks permission/);

  // HSE & Quality → 403
  let codeHse = null;
  let bodyHse = null;
  getSyncJournal({ user: { id: "u-hse" }, db, query: {} }, {
    status(c) { codeHse = c; return this; },
    json(b) { bodyHse = b; return this; }
  });
  assert.equal(codeHse, 403, "HSE & Quality must be denied");
  assert.match(bodyHse.message, /lacks permission/);
});

// ── RESTORED PRE-EXISTING BEHAVIOR REGRESSION TESTS (R-01 to R-06) ───────────

// R-01: Duplicate INSERT behavior is preserved (pushes record and increments committed_count)
test("R-01: Duplicate INSERT behavior pushes record and increments committed_count", () => {
  const db = {
    equipment_tags: [
      { id: "eq-existing", plant_section_id: "sec-1", tag_code: "PMP-001", equipment_name: "Original Pump", criticality: "high", status: "active" }
    ],
    offline_sync_journal: []
  };
  const store = createMockStore();
  const actor = { id: "u-admin", role: "Admin", is_active: true };

  const summary = processBatchOfflineSync(db, store, actor, "DEV-01", [
    {
      client_mutation_id: "mut-insert-dup",
      entity_type: "equipment_tag",
      entity_id: "eq-existing",
      operation: "INSERT",
      client_timestamp: "2026-11-20T11:00:00Z",
      payload: {
        plant_section_id: "sec-1",
        tag_code: "PMP-001",
        equipment_name: "Duplicate Pump",
        criticality: "medium",
        status: "active"
      }
    }
  ]);

  assert.equal(summary.committed_count, 1, "Duplicate INSERT commits record per original logic");
  assert.equal(summary.conflict_count, 0);
  assert.equal(summary.results[0].status, "COMMITTED");
  assert.equal(db.equipment_tags.length, 2, "Both records exist in collection");
});

// R-02: UPDATE of missing record behavior is preserved (inserts record and increments committed_count)
test("R-02: UPDATE of missing record inserts record and increments committed_count", () => {
  const db = {
    equipment_tags: [],
    offline_sync_journal: []
  };
  const store = createMockStore();
  const actor = { id: "u-admin", role: "Admin", is_active: true };

  const summary = processBatchOfflineSync(db, store, actor, "DEV-01", [
    {
      client_mutation_id: "mut-update-missing",
      entity_type: "equipment_tag",
      entity_id: "eq-new-from-update",
      operation: "UPDATE",
      client_timestamp: "2026-11-20T11:30:00Z",
      payload: {
        plant_section_id: "sec-1",
        tag_code: "PMP-099",
        equipment_name: "Upserted Pump",
        criticality: "low",
        status: "active"
      }
    }
  ]);

  assert.equal(summary.committed_count, 1, "UPDATE of missing record commits as new record");
  assert.equal(summary.conflict_count, 0);
  assert.equal(summary.results[0].status, "COMMITTED");
  assert.equal(db.equipment_tags.length, 1);
  const inserted = db.equipment_tags[0];
  assert.equal(inserted.id, "eq-new-from-update");
  assert.equal(inserted.sync_device_id, "DEV-01");
  assert.ok(inserted.server_synced_at);
});

// R-03: Existing conflict status value CONFLICT_REVIEW and conflict_details shape
test("R-03: Existing conflict status value is CONFLICT_REVIEW with colliding_fields", () => {
  const db = {
    equipment_tags: [
      {
        id: "eq-001",
        plant_section_id: "sec-1",
        tag_code: "PMP-001",
        equipment_name: "Server Pump Name",
        criticality: "high",
        status: "active",
        updated_at: "2026-11-20T12:00:00Z"
      }
    ],
    offline_sync_journal: []
  };
  const store = createMockStore();
  const actor = { id: "u-admin", role: "Admin", is_active: true };

  // Client timestamp is older than server updated_at, and field equipment_name collides
  const summary = processBatchOfflineSync(db, store, actor, "DEV-01", [
    {
      client_mutation_id: "mut-conflict-01",
      entity_type: "equipment_tag",
      entity_id: "eq-001",
      operation: "UPDATE",
      client_timestamp: "2026-11-20T11:00:00Z",
      payload: {
        equipment_name: "Client Pump Name"
      }
    }
  ]);

  assert.equal(summary.conflict_count, 1);
  assert.equal(summary.committed_count, 0);
  assert.equal(summary.results[0].status, "CONFLICT_REVIEW", "Status must be CONFLICT_REVIEW, not CONFLICT");
  const details = summary.results[0].conflict_details;
  assert.ok(details);
  assert.ok(details.colliding_fields);
  assert.equal(details.colliding_fields[0].field, "equipment_name");
  assert.equal(details.colliding_fields[0].server_value, "Server Pump Name");
  assert.equal(details.colliding_fields[0].client_value, "Client Pump Name");
  assert.equal(details.client_timestamp, "2026-11-20T11:00:00Z");
  assert.equal(details.server_timestamp, "2026-11-20T12:00:00Z");
});

// R-04: Existing successful journal fields, including payload behavior
test("R-04: Successful journal entries use store.id('jrn') and persist payload", () => {
  const db = {
    equipment_tags: [],
    offline_sync_journal: []
  };
  const store = createMockStore();
  const actor = { id: "u-admin", role: "Admin", is_active: true };

  processBatchOfflineSync(db, store, actor, "DEV-01", [
    {
      client_mutation_id: "mut-jrn-check",
      entity_type: "equipment_tag",
      entity_id: "eq-jrn-1",
      operation: "INSERT",
      client_timestamp: "2026-11-20T13:00:00Z",
      payload: {
        plant_section_id: "sec-1",
        tag_code: "PMP-777",
        equipment_name: "Journal Test Pump",
        criticality: "medium",
        status: "active"
      }
    }
  ]);

  assert.equal(db.offline_sync_journal.length, 1);
  const entry = db.offline_sync_journal[0];
  assert.ok(entry.id.startsWith("jrn_"), "Journal ID prefix must be 'jrn'");
  assert.equal(entry.client_mutation_id, "mut-jrn-check");
  assert.equal(entry.entity_type, "equipment_tag");
  assert.equal(entry.entity_id, "eq-jrn-1");
  assert.equal(entry.operation, "INSERT");
  assert.equal(entry.client_timestamp, "2026-11-20T13:00:00Z");
  assert.ok(entry.server_timestamp);
  assert.equal(entry.sync_status, "COMMITTED");
  assert.deepEqual(entry.payload, {
    plant_section_id: "sec-1",
    tag_code: "PMP-777",
    equipment_name: "Journal Test Pump",
    criticality: "medium",
    status: "active"
  });
});

// R-05: resolveSyncConflict lookup by either client_mutation_id or journal ID, and existing contract
test("R-05: resolveSyncConflict lookup by either client_mutation_id or journal ID, uses merged_payload and resolution_notes", () => {
  const db = {
    equipment_tags: [
      { id: "eq-001", plant_section_id: "sec-1", tag_code: "PMP-001", equipment_name: "Server Name", criticality: "high", status: "active" },
      { id: "eq-002", plant_section_id: "sec-1", tag_code: "PMP-002", equipment_name: "Server Name 2", criticality: "high", status: "active" }
    ],
    offline_sync_journal: [
      {
        id: "jrn_1",
        client_mutation_id: "mut-by-client-id",
        entity_type: "equipment_tag",
        entity_id: "eq-001",
        sync_status: "CONFLICT_REVIEW",
        payload: { equipment_name: "Client Name" }
      },
      {
        id: "jrn_2",
        client_mutation_id: "mut-by-jrn-id",
        entity_type: "equipment_tag",
        entity_id: "eq-002",
        sync_status: "CONFLICT_REVIEW",
        payload: { equipment_name: "Client Name 2" }
      }
    ]
  };
  const store = createMockStore();
  const actor = { id: "u-admin", role: "Admin", is_active: true };

  // 1. Resolve using client_mutation_id with ACCEPT_CLIENT
  const res1 = resolveSyncConflict(db, store, actor, "mut-by-client-id", {
    resolution_strategy: "ACCEPT_CLIENT",
    resolution_notes: "Accepted client name"
  });
  assert.equal(res1.id, "jrn_1");
  assert.equal(res1.sync_status, "RESOLVED");
  assert.equal(res1.resolved_by_id, "u-admin");
  assert.equal(res1.resolution_notes, "Accepted client name");
  assert.ok(res1.resolved_at);
  assert.equal(db.equipment_tags[0].equipment_name, "Client Name");

  // 2. Resolve using journal ID with MERGE_MANUAL (merged_payload)
  const res2 = resolveSyncConflict(db, store, actor, "jrn_2", {
    resolution_strategy: "MERGE_MANUAL",
    merged_payload: { equipment_name: "Merged Manual Name" },
    resolution_notes: "Merged manually"
  });
  assert.equal(res2.id, "jrn_2");
  assert.equal(res2.sync_status, "RESOLVED");
  assert.equal(res2.resolved_by_id, "u-admin");
  assert.equal(res2.resolution_notes, "Merged manually");
  assert.equal(db.equipment_tags[1].equipment_name, "Merged Manual Name");

  // Verify audit log action
  const audit = store.audits.find((a) => a.action === "SYNC_CONFLICT_RESOLVED");
  assert.ok(audit, "Audit action must be SYNC_CONFLICT_RESOLVED");
});

// R-06: Existing response field names and route/API contract
test("R-06: processBatchOfflineSync response contract exactly matches existing shape", () => {
  const db = {
    equipment_tags: [],
    offline_sync_journal: []
  };
  const store = createMockStore();
  const actor = { id: "u-admin", role: "Admin", is_active: true };

  const summary = processBatchOfflineSync(db, store, actor, "DEV-01", [
    {
      client_mutation_id: "mut-shape-check",
      entity_type: "equipment_tag",
      entity_id: "eq-shape",
      operation: "INSERT",
      client_timestamp: "2026-11-20T14:00:00Z",
      payload: { plant_section_id: "s1", tag_code: "T-01", equipment_name: "Pump", criticality: "high", status: "active" }
    }
  ]);

  const keys = Object.keys(summary).sort();
  assert.deepEqual(keys, ["committed_count", "conflict_count", "device_id", "results", "success", "total_processed"].sort());
  assert.equal(summary.success, true);
  assert.equal(summary.device_id, "DEV-01");
  assert.equal(summary.total_processed, 1);
  assert.equal(summary.committed_count, 1);
  assert.equal(summary.conflict_count, 0);
  assert.equal(summary.results.length, 1);
  assert.equal(summary.results[0].client_mutation_id, "mut-shape-check");
  assert.equal(summary.results[0].status, "COMMITTED");
  assert.equal(summary.results[0].replayed, false);
  assert.equal(summary.results[0].conflict_details, null);
  assert.equal(summary.results[0].entity_id, "eq-shape");
});
