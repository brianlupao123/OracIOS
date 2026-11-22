// backend/src/controllers/syncController.js
//
// Controller for Subsystem 13: Offline Sync Engine & Conflict Resolution.
// Ingests batched mutations from offline field devices and reconciles state.

import {
  BatchSyncSchema,
  ResolveConflictSchema
} from "../schemas.js";

import {
  processBatchOfflineSync,
  resolveSyncConflict
} from "../services/offlineSyncService.js";

function resolveActor(req) {
  if (!req.user?.id) return null;
  return (req.db?.users || []).find((user) => user.id === req.user.id) || null;
}

function checkPermission(actor, allowedRoles = ["Admin", "Management", "Operations", "Supervisor", "Technician"]) {
  if (!actor) {
    const err = new Error("Unauthorized. Authentication required.");
    err.statusCode = 401;
    throw err;
  }
  if (!allowedRoles.includes(actor.role)) {
    const err = new Error(`Forbidden: role '${actor?.role}' lacks permission`);
    err.statusCode = 403;
    throw err;
  }
}

export const syncBatchMutations = (req, res) => {
  try {
    const actor = resolveActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Technician"]);

    const parseResult = BatchSyncSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid sync batch payload",
        errors: parseResult.error.issues
      });
    }

    const { client_device_id, mutations } = parseResult.data;
    const summary = processBatchOfflineSync(req.db, req.store, actor, client_device_id, mutations);

    return res.status(200).json(summary);
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const getSyncJournal = (req, res) => {
  try {
    const actor = resolveActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor"]);

    req.db.offline_sync_journal = req.db.offline_sync_journal || [];
    let list = [...req.db.offline_sync_journal];

    if (req.query.status) {
      list = list.filter((j) => j.sync_status === req.query.status);
    }
    if (req.query.entity_type) {
      list = list.filter((j) => j.entity_type === req.query.entity_type);
    }

    return res.json({
      success: true,
      data: list
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const resolveConflict = (req, res) => {
  try {
    const actor = resolveActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor"]);

    const parseResult = ResolveConflictSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid conflict resolution data",
        errors: parseResult.error.issues
      });
    }

    const updatedJournal = resolveSyncConflict(req.db, req.store, actor, req.params.id, parseResult.data);

    return res.json({
      success: true,
      data: updatedJournal
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};
