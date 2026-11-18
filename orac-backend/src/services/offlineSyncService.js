// backend/src/services/offlineSyncService.js
//
// Offline Sync & Conflict Resolution Engine for mobile field companions.
// Harvested from Wachiye tailpos offline background job & sync architecture.

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

    const targetCollection = resolveCollection(db, mut.entity_type);
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

function resolveCollection(db, entityType) {
  switch (entityType) {
    case "timesheet":
      db.timesheets = db.timesheets || [];
      return db.timesheets;
    case "worksheet":
      db.field_worksheets = db.field_worksheets || [];
      return db.field_worksheets;
    case "inspection":
      db.pre_dispatch_ppe_checklists = db.pre_dispatch_ppe_checklists || [];
      return db.pre_dispatch_ppe_checklists;
    case "equipment_tag":
      db.equipment_tags = db.equipment_tags || [];
      return db.equipment_tags;
    default:
      db.timesheets = db.timesheets || [];
      return db.timesheets;
  }
}

export function resolveSyncConflict(db, store, actor, mutationId, resolution) {
  db.offline_sync_journal = db.offline_sync_journal || [];
  const journalEntry = db.offline_sync_journal.find((j) => j.client_mutation_id === mutationId || j.id === mutationId);

  if (!journalEntry) {
    const err = new Error("Sync journal entry not found");
    err.statusCode = 404;
    throw err;
  }

  const targetCollection = resolveCollection(db, journalEntry.entity_type);
  const existingRecord = targetCollection.find((item) => item.id === journalEntry.entity_id);

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
