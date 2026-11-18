/**
 * fileUploadController.js — HTTP handlers for File Upload
 *
 * Routes:
 *   POST   /uploads                                 — upload a file
 *   GET    /uploads/:id                              — get file metadata
 *   GET    /uploads/entity/:entityType/:entityId      — list files for an entity
 *   DELETE /uploads/:id                              — soft-delete a file
 *   GET    /uploads/stats                            — upload statistics
 */

import {
  processUpload,
  FileUploadStore,
} from "../services/fileUploadService.js";

// Singleton store (in production, replace with DB-backed store)
let _store = null;
function getStore() {
  if (!_store) _store = new FileUploadStore();
  return _store;
}

export function postUpload(req, res) {
  try {
    const store = getStore();

    // If multer middleware was used, file is in req.file
    // Otherwise, expect JSON body with base64 content
    const file = req.file;
    let params;

    if (file) {
      // Multer-processed upload
      params = {
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        buffer: file.buffer,
        category: req.body.category || "general",
        entityType: req.body.entityType,
        entityId: req.body.entityId,
        uploadedBy: req.user?.id || req.body.uploadedBy,
        description: req.body.description,
      };
    } else {
      // JSON body upload (for testing without multer middleware)
      params = {
        originalName: req.body.originalName,
        mimeType: req.body.mimeType,
        sizeBytes: req.body.sizeBytes || (req.body.content ? Buffer.byteLength(req.body.content, "base64") : 0),
        buffer: req.body.content ? Buffer.from(req.body.content, "base64") : null,
        category: req.body.category || "general",
        entityType: req.body.entityType,
        entityId: req.body.entityId,
        uploadedBy: req.user?.id || req.body.uploadedBy,
        description: req.body.description,
      };
    }

    const result = processUpload(store, params);
    if (!result.success) {
      return res.status(400).json({ ok: false, error: result.error });
    }

    res.status(201).json({ ok: true, file: result.file });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function getFile(req, res) {
  try {
    const store = getStore();
    const file = store.getById(req.params.id);
    if (!file) {
      return res.status(404).json({ ok: false, error: "File not found" });
    }
    res.json({ ok: true, file });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function getEntityFiles(req, res) {
  try {
    const store = getStore();
    const files = store.listByEntity(
      req.params.entityType,
      req.params.entityId,
      { category: req.query.category }
    );
    res.json({ ok: true, files, count: files.length });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function deleteFile(req, res) {
  try {
    const store = getStore();
    const deleted = store.softDelete(req.params.id, req.user?.id || req.body.deletedBy);
    if (!deleted) {
      return res.status(404).json({ ok: false, error: "File not found" });
    }
    res.json({ ok: true, file: deleted });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function getUploadStats(req, res) {
  try {
    const store = getStore();
    const stats = store.getStats();
    res.json({ ok: true, stats });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

// For testing: allow resetting the store
export function _resetStore() {
  _store = null;
}
