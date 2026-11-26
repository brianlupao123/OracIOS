// backend/src/services/offlineSyncService.js
//
// Offline Sync & Conflict Resolution Engine for mobile field companions.
// Hardened per Batch C generic sync requirements (R1-R7).
// Harvested from Wachiye tailpos offline background job & sync architecture.

import { hasPermission } from "../permissions.js";

// R1: Explicit allow-list of generic offline-sync entity types.
// Timesheet creation remains through dispatchController createWorksheet only.
export const ALLOWED_ENTITY_TYPES = ["inspection", "equipment_tag"];

// R2: Protected collections — refused for every operation through sync.
export const PROTECTED_ENTITY_TYPES = [
  "timesheet",
  "worksheet",
  "field_worksheets",
  "timesheets",
  "worksheet_registers",
  "worksheet_register",
  "timesheet_authorities",
  "timesheet_paper_custody",
  "client_dispatch_authorisations",
  "audit_logs",
  "users",
  "invoices",
  "invoice_drafts"
];

// R7: Per-operation permission enforcement via permissions.js
export const ENTITY_PERMISSIONS = {
  inspection: "managePpeChecklists",
  equipment_tag: "manageAssets"
};

// R4: Protected fields — refused for all entity types.
// Approval, acknowledgement, rate, amount, lock, and evidence lineage fields.
export const PROTECTED_FIELDS = new Set([
  "id",
  "client_acknowledgement",
  "acknowledgement_history",
  "superseded_by",
  "invoice_locked",
  "hourly_rate",
  "hours_logged",
  "normal_hours",
  "overtime_hours",
  "approved_by",
  "approved_at",
  "reviewed_by",
  "reviewed_at",
  "total_amount",
  "rate",
  "amount",
  "evidence_reference",
  "evidence_hash",
  "signature",
  "signature_evidence",
  "client_returns",
  "return_history"
]);

// R4: Per-type field allow-list reconciled against actual schemas and controllers:
// - inspection: PreDispatchPpeChecklistSchema (schemas.js L926-939) & hseController.js
// - equipment_tag: AdminCreateEquipmentTagSchema (schemas.js L428-434) & adminController.js
// Payload keys outside the list are refused (not silently dropped).
export const ALLOWED_FIELDS = {
  inspection: new Set([
    "dispatch_card_id",
    "technician_id",
    "technician_name",
    "site_location",
    "hard_hat_pass",
    "metatarsal_boots_pass",
    "heavy_chemical_gloves_pass",
    "safety_glasses_pass",
    "high_vis_vest_pass",
    "respirator_mask_pass",
    "ear_protection_pass",
    "fall_arrest_harness_pass"
  ]),
  equipment_tag: new Set([
    "plant_section_id",
    "tag_code",
    "equipment_name",
    "criticality",
    "status"
  ])
};

export function processBatchOfflineSync(db, store, actor, deviceId, mutations) {
  db.offline_sync_journal = db.offline_sync_journal || [];

  const results = [];
  let committedCount = 0;
  let conflictCount = 0;

  for (const mut of mutations) {
    // 1. Idempotency Check: if already processed, return existing journal record
    const existing = db.offline_sync_journal.find((j) => j.client_mutation_id === mut.client_mutation_id);
    if (existing) {
      results.push({
        client_mutation_id: mut.client_mutation_id,
        status: existing.sync_status,
        replayed: true,
        entity_id: existing.entity_id
      });
      continue;
    }

    // ── SECURITY GATE (Hardening Controls) ───────────────────────────────────

    // R2: Refuse protected entity types
    if (PROTECTED_ENTITY_TYPES.includes(mut.entity_type)) {
      const refusalReason = `Protected entity type '${mut.entity_type}' cannot be mutated via generic offline sync`;
      recordRefusal(db, store, actor, mut, refusalReason);
      results.push({
        client_mutation_id: mut.client_mutation_id,
        status: "REFUSED",
        refusal_reason: refusalReason,
        entity_id: mut.entity_id
      });
      continue;
    }

    // R1: Explicit allow-list of entity types — refuse unknown types
    if (!ALLOWED_ENTITY_TYPES.includes(mut.entity_type)) {
      const refusalReason = `Entity type '${mut.entity_type}' is not permitted for generic offline sync`;
      recordRefusal(db, store, actor, mut, refusalReason);
      results.push({
        client_mutation_id: mut.client_mutation_id,
        status: "REFUSED",
        refusal_reason: refusalReason,
        entity_id: mut.entity_id
      });
      continue;
    }

    // R7: Per-operation permission enforcement against permissions.js
    const requiredPermission = ENTITY_PERMISSIONS[mut.entity_type];
    if (requiredPermission && !hasPermission(actor, requiredPermission)) {
      const refusalReason = `Actor role '${actor?.role}' lacks '${requiredPermission}' required for '${mut.entity_type}'`;
      recordRefusal(db, store, actor, mut, refusalReason);
      results.push({
        client_mutation_id: mut.client_mutation_id,
        status: "REFUSED",
        refusal_reason: refusalReason,
        entity_id: mut.entity_id
      });
      continue;
    }

    // R3: DELETE is refused on all business collections through sync
    if (mut.operation === "DELETE") {
      const refusalReason = `DELETE operation is refused for business collection '${mut.entity_type}'`;
      recordRefusal(db, store, actor, mut, refusalReason);
      results.push({
        client_mutation_id: mut.client_mutation_id,
        status: "REFUSED",
        refusal_reason: refusalReason,
        entity_id: mut.entity_id
      });
      continue;
    }

    // R4: Refuse protected fields and validate allowed fields
    const payloadKeys = Object.keys(mut.payload || {});
    const protectedKey = payloadKeys.find((k) => PROTECTED_FIELDS.has(k));
    if (protectedKey) {
      const refusalReason = `Field '${protectedKey}' is protected and cannot be mutated via offline sync`;
      recordRefusal(db, store, actor, mut, refusalReason);
      results.push({
        client_mutation_id: mut.client_mutation_id,
        status: "REFUSED",
        refusal_reason: refusalReason,
        entity_id: mut.entity_id
      });
      continue;
    }

    const typeAllowed = ALLOWED_FIELDS[mut.entity_type];
    const invalidKey = typeAllowed ? payloadKeys.find((k) => !typeAllowed.has(k)) : null;
    if (invalidKey) {
      const refusalReason = `Field '${invalidKey}' is not permitted for entity type '${mut.entity_type}'`;
      recordRefusal(db, store, actor, mut, refusalReason);
      results.push({
        client_mutation_id: mut.client_mutation_id,
        status: "REFUSED",
        refusal_reason: refusalReason,
        entity_id: mut.entity_id
      });
      continue;
    }

    // Resolve collection safely — no fall-through to timesheets
    const targetCollection = resolveCollection(db, mut.entity_type);
    if (!targetCollection) {
      const refusalReason = `No valid collection resolved for '${mut.entity_type}'`;
      recordRefusal(db, store, actor, mut, refusalReason);
      results.push({
        client_mutation_id: mut.client_mutation_id,
        status: "REFUSED",
        refusal_reason: refusalReason,
        entity_id: mut.entity_id
      });
      continue;
    }

    // ── PRESERVED ORIGINAL PERMITTED MUTATION LOGIC ──────────────────────────

    let syncStatus = "COMMITTED";
    let conflictDetails = null;

    if (mut.operation === "INSERT") {
      const record = {
        id: mut.entity_id || store.id(mut.entity_type.slice(0, 3)),
        ...mut.payload,
        sync_device_id: deviceId,
        created_at: mut.client_timestamp,
        server_synced_at: new Date().toISOString()
      };
      targetCollection.push(record);
      committedCount++;
    } else if (mut.operation === "UPDATE") {
      const existingRecord = targetCollection.find((item) => item.id === mut.entity_id);

      if (!existingRecord) {
        // Record does not exist on server: insert it
        const record = {
          id: mut.entity_id,
          ...mut.payload,
          sync_device_id: deviceId,
          updated_at: mut.client_timestamp,
          server_synced_at: new Date().toISOString()
        };
        targetCollection.push(record);
        committedCount++;
      } else {
        // Conflict Detection: check if server record has newer modifications
        const serverUpdatedAt = existingRecord.updated_at || existingRecord.server_synced_at || existingRecord.created_at;
        const clientTimestamp = new Date(mut.client_timestamp).getTime();
        const serverTimestamp = serverUpdatedAt ? new Date(serverUpdatedAt).getTime() : 0;

        if (serverTimestamp > clientTimestamp) {
          // Concurrent edit detected: check for field collision
          const collidingFields = [];
          for (const [key, clientVal] of Object.entries(mut.payload)) {
            if (existingRecord[key] !== undefined && JSON.stringify(existingRecord[key]) !== JSON.stringify(clientVal)) {
              collidingFields.push({
                field: key,
                server_value: existingRecord[key],
                client_value: clientVal
              });
            }
          }

          if (collidingFields.length > 0) {
            syncStatus = "CONFLICT_REVIEW";
            conflictDetails = {
              colliding_fields: collidingFields,
              client_timestamp: mut.client_timestamp,
              server_timestamp: serverUpdatedAt
            };
            conflictCount++;
          } else {
            // Non-colliding merge (distinct fields)
            Object.assign(existingRecord, mut.payload, {
              server_synced_at: new Date().toISOString()
            });
            committedCount++;
          }
        } else {
          // Client is newer: apply Last-Write-Wins update
          Object.assign(existingRecord, mut.payload, {
            server_synced_at: new Date().toISOString()
          });
          committedCount++;
        }
      }
    } else if (mut.operation === "DELETE") {
      const idx = targetCollection.findIndex((item) => item.id === mut.entity_id);
      if (idx !== -1) {
        targetCollection.splice(idx, 1);
        committedCount++;
      }
    }

    const journalEntry = {
      id: store.id("jrn"),
      client_mutation_id: mut.client_mutation_id,
      entity_type: mut.entity_type,
      entity_id: mut.entity_id,
      operation: mut.operation,
      client_timestamp: mut.client_timestamp,
      server_timestamp: new Date().toISOString(),
      sync_status: syncStatus,
      conflict_details: conflictDetails,
      payload: mut.payload
    };

    db.offline_sync_journal.push(journalEntry);

    store.audit(db, actor, "offline_sync", journalEntry.id, "MUTATION_SYNCED", null, {
      entity_type: mut.entity_type,
      entity_id: mut.entity_id,
      sync_status: syncStatus
    });

    results.push({
      client_mutation_id: mut.client_mutation_id,
      status: syncStatus,
      replayed: false,
      conflict_details: conflictDetails,
      entity_id: mut.entity_id
    });
  }

  return {
    success: true,
    device_id: deviceId,
    total_processed: mutations.length,
    committed_count: committedCount,
    conflict_count: conflictCount,
    results
  };
}

// R6: Refused operations are recorded in the journal without the raw payload
function recordRefusal(db, store, actor, mut, refusalReason) {
  const journalEntry = {
    id: store.id("jrn"),
    client_mutation_id: mut.client_mutation_id,
    entity_type: mut.entity_type,
    entity_id: mut.entity_id,
    operation: mut.operation,
    client_timestamp: mut.client_timestamp,
    server_timestamp: new Date().toISOString(),
    sync_status: "REFUSED",
    conflict_details: { refusal_reason: refusalReason }
  };

  db.offline_sync_journal.push(journalEntry);

  store.audit(db, actor || { id: "anonymous" }, "offline_sync", journalEntry.id, "MUTATION_REFUSED", null, {
    entity_type: mut.entity_type,
    entity_id: mut.entity_id,
    refusal_reason: refusalReason
  });
}

// R1 & R2: Only explicitly supported generic entities resolve; no default fall-through
function resolveCollection(db, entityType) {
  switch (entityType) {
    case "inspection":
      db.pre_dispatch_ppe_checklists = db.pre_dispatch_ppe_checklists || [];
      return db.pre_dispatch_ppe_checklists;
    case "equipment_tag":
      db.equipment_tags = db.equipment_tags || [];
      return db.equipment_tags;
    default:
      return null;
  }
}

// R5: resolveSyncConflict lookup by either client_mutation_id or id, with security gates
export function resolveSyncConflict(db, store, actor, mutationId, resolution) {
  db.offline_sync_journal = db.offline_sync_journal || [];
  const journalEntry = db.offline_sync_journal.find((j) => j.client_mutation_id === mutationId || j.id === mutationId);

  if (!journalEntry) {
    const err = new Error("Sync journal entry not found");
    err.statusCode = 404;
    throw err;
  }

  // Refuse resolving conflicts on protected or unknown entity types
  if (PROTECTED_ENTITY_TYPES.includes(journalEntry.entity_type) || !ALLOWED_ENTITY_TYPES.includes(journalEntry.entity_type)) {
    const err = new Error(`Cannot resolve conflict on protected/unknown entity type '${journalEntry.entity_type}'`);
    err.statusCode = 403;
    throw err;
  }

  // Per-operation permission check
  const requiredPermission = ENTITY_PERMISSIONS[journalEntry.entity_type];
  if (requiredPermission && !hasPermission(actor, requiredPermission)) {
    const err = new Error(`Actor lacks '${requiredPermission}' required to resolve conflict on '${journalEntry.entity_type}'`);
    err.statusCode = 403;
    throw err;
  }

  // Validate payloads against protected fields and allowed fields
  if (resolution.resolution_strategy === "ACCEPT_CLIENT") {
    validateConflictPayload(journalEntry.entity_type, journalEntry.payload);
  } else if (resolution.resolution_strategy === "MERGE_MANUAL" && resolution.merged_payload) {
    validateConflictPayload(journalEntry.entity_type, resolution.merged_payload);
  }

  const targetCollection = resolveCollection(db, journalEntry.entity_type);
  const existingRecord = targetCollection ? targetCollection.find((item) => item.id === journalEntry.entity_id) : null;

  if (resolution.resolution_strategy === "ACCEPT_CLIENT") {
    if (existingRecord) {
      Object.assign(existingRecord, journalEntry.payload, {
        server_synced_at: new Date().toISOString()
      });
    }
  } else if (resolution.resolution_strategy === "MERGE_MANUAL" && resolution.merged_payload) {
    if (existingRecord) {
      Object.assign(existingRecord, resolution.merged_payload, {
        server_synced_at: new Date().toISOString()
      });
    }
  }

  journalEntry.sync_status = "RESOLVED";
  journalEntry.resolved_by_id = actor.id;
  journalEntry.resolution_notes = resolution.resolution_notes;
  journalEntry.resolved_at = new Date().toISOString();

  store.audit(db, actor, "offline_sync", journalEntry.id, "SYNC_CONFLICT_RESOLVED", null, {
    strategy: resolution.resolution_strategy,
    notes: resolution.resolution_notes
  });

  return journalEntry;
}

// R4 & R5 helper: validates payload fields during conflict resolution
function validateConflictPayload(entityType, payload) {
  const keys = Object.keys(payload || {});
  const protectedKey = keys.find((k) => PROTECTED_FIELDS.has(k));
  if (protectedKey) {
    const err = new Error(`Field '${protectedKey}' is protected and cannot be written via conflict resolution`);
    err.statusCode = 400;
    throw err;
  }
  const typeAllowed = ALLOWED_FIELDS[entityType];
  const invalidKey = typeAllowed ? keys.find((k) => !typeAllowed.has(k)) : null;
  if (invalidKey) {
    const err = new Error(`Field '${invalidKey}' is not permitted for entity type '${entityType}'`);
    err.statusCode = 400;
    throw err;
  }
}
