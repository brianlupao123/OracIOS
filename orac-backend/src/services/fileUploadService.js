/**
 * fileUploadService.js — ORAC File Upload Service
 *
 * Provides structured file upload handling for the ORAC ERP system.
 * Supports: artisan documents, dispatch attachments, fleet photos,
 * HSE incident photos, quality inspection evidence, general documents.
 *
 * Features:
 *   - MIME type validation with allowlist
 *   - File size limits (configurable per category)
 *   - Virus-safe filename sanitisation
 *   - Metadata tracking (uploader, category, linked entity)
 *   - File retrieval and listing by entity
 *   - Soft-delete with audit trail
 *   - Storage abstraction (disk today, S3-compatible later)
 *
 * Uses Multer for multipart parsing but wraps it in a service layer
 * so controllers remain thin.
 */

import { randomUUID } from "crypto";

// ─── Configuration ───────────────────────────────────────────────

export const UPLOAD_CATEGORIES = {
  artisan_document:    { maxSizeMB: 10, allowedMimes: ["application/pdf", "image/jpeg", "image/png", "image/webp"] },
  dispatch_attachment: { maxSizeMB: 25, allowedMimes: ["application/pdf", "image/jpeg", "image/png", "image/webp", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] },
  fleet_photo:         { maxSizeMB: 15, allowedMimes: ["image/jpeg", "image/png", "image/webp"] },
  hse_incident_photo:  { maxSizeMB: 15, allowedMimes: ["image/jpeg", "image/png", "image/webp"] },
  quality_evidence:    { maxSizeMB: 25, allowedMimes: ["application/pdf", "image/jpeg", "image/png", "image/webp"] },
  general:             { maxSizeMB: 20, allowedMimes: ["application/pdf", "image/jpeg", "image/png", "image/webp", "text/plain", "text/csv"] },
};

export const DANGEROUS_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".com", ".msi", ".scr", ".pif", ".js",
  ".vbs", ".wsf", ".ps1", ".sh", ".php", ".asp", ".aspx", ".jsp",
  ".cgi", ".dll", ".sys", ".reg", ".hta",
]);

// ─── Filename Sanitisation ───────────────────────────────────────

/**
 * Sanitises a user-supplied filename:
 *  - Strips path separators (directory traversal)
 *  - Removes null bytes
 *  - Replaces non-ASCII and control chars
 *  - Truncates to 200 chars (preserving extension)
 *  - Rejects dangerous extensions
 */
export function sanitiseFilename(originalName) {
  if (!originalName || typeof originalName !== "string") {
    return { safe: null, error: "Missing filename" };
  }

  // Strip path components
  let name = originalName.replace(/\\/g, "/");
  name = name.split("/").pop();

  // Remove null bytes and control characters
  name = name.replace(/[\x00-\x1f\x7f]/g, "");

  // Replace problematic characters
  name = name.replace(/[<>:"|?*]/g, "_");

  // Trim whitespace and dots from edges
  name = name.replace(/^[\s.]+|[\s.]+$/g, "");

  if (!name || name.length === 0) {
    return { safe: null, error: "Filename is empty after sanitisation" };
  }

  // Check dangerous extensions
  const dotIdx = name.lastIndexOf(".");
  const ext = dotIdx >= 0 ? name.slice(dotIdx).toLowerCase() : "";
  if (DANGEROUS_EXTENSIONS.has(ext)) {
    return { safe: null, error: `File extension '${ext}' is not allowed` };
  }

  // Truncate to 200 chars preserving extension
  const MAX_LEN = 200;
  if (name.length > MAX_LEN) {
    const base = dotIdx >= 0 ? name.slice(0, dotIdx) : name;
    name = base.slice(0, MAX_LEN - ext.length) + ext;
  }

  return { safe: name, error: null };
}

// ─── MIME Validation ─────────────────────────────────────────────

export function validateMimeType(mimeType, category) {
  const config = UPLOAD_CATEGORIES[category];
  if (!config) {
    return { valid: false, error: `Unknown upload category: '${category}'` };
  }

  if (!mimeType || typeof mimeType !== "string") {
    return { valid: false, error: "Missing MIME type" };
  }

  const normalised = mimeType.toLowerCase().trim();
  if (!config.allowedMimes.includes(normalised)) {
    return {
      valid: false,
      error: `MIME type '${normalised}' is not allowed for category '${category}'. Allowed: ${config.allowedMimes.join(", ")}`,
    };
  }

  return { valid: true, error: null };
}

// ─── File Size Validation ────────────────────────────────────────

export function validateFileSize(sizeBytes, category) {
  const config = UPLOAD_CATEGORIES[category];
  if (!config) {
    return { valid: false, error: `Unknown upload category: '${category}'`, limitMB: 0 };
  }

  const limitBytes = config.maxSizeMB * 1024 * 1024;
  if (typeof sizeBytes !== "number" || sizeBytes <= 0) {
    return { valid: false, error: "Invalid file size", limitMB: config.maxSizeMB };
  }

  if (sizeBytes > limitBytes) {
    return {
      valid: false,
      error: `File size ${(sizeBytes / (1024 * 1024)).toFixed(1)}MB exceeds ${config.maxSizeMB}MB limit for '${category}'`,
      limitMB: config.maxSizeMB,
    };
  }

  return { valid: true, error: null, limitMB: config.maxSizeMB };
}

// ─── Storage Key Generation ──────────────────────────────────────

export function generateStorageKey(category, sanitisedName) {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const uuid = randomUUID();
  return `${category}/${year}/${month}/${uuid}_${sanitisedName}`;
}

// ─── In-Memory File Store ────────────────────────────────────────

export class FileUploadStore {
  constructor() {
    this._files = new Map();
    this._nextId = 1;
  }

  register(params) {
    const {
      originalName, sanitisedName, storageKey, mimeType,
      sizeBytes, category, entityType, entityId,
      uploadedBy, description, buffer,
    } = params;

    const id = String(this._nextId++);
    const record = {
      id,
      originalName,
      sanitisedName,
      storageKey,
      mimeType,
      sizeBytes,
      category,
      entityType,
      entityId,
      uploadedBy,
      description: description || null,
      status: "active",
      uploadedAt: new Date().toISOString(),
      deletedAt: null,
      deletedBy: null,
      _buffer: buffer || null,
    };

    this._files.set(id, record);
    return this._toPublic(record);
  }

  getById(id) {
    const record = this._files.get(id);
    if (!record || record.status === "deleted") return null;
    return this._toPublic(record);
  }

  getBuffer(id) {
    const record = this._files.get(id);
    if (!record || record.status === "deleted") return null;
    return record._buffer;
  }

  listByEntity(entityType, entityId, opts = {}) {
    const results = [];
    for (const record of this._files.values()) {
      if (record.status === "deleted") continue;
      if (record.entityType !== entityType) continue;
      if (record.entityId !== entityId) continue;
      if (opts.category && record.category !== opts.category) continue;
      results.push(this._toPublic(record));
    }
    return results.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  listByCategory(category) {
    const results = [];
    for (const record of this._files.values()) {
      if (record.status === "deleted") continue;
      if (record.category !== category) continue;
      results.push(this._toPublic(record));
    }
    return results.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  }

  softDelete(id, deletedBy) {
    const record = this._files.get(id);
    if (!record || record.status === "deleted") return null;

    record.status = "deleted";
    record.deletedAt = new Date().toISOString();
    record.deletedBy = deletedBy;
    return this._toPublic(record);
  }

  getStats() {
    const stats = {
      totalFiles: 0,
      totalSizeBytes: 0,
      byCategory: {},
      activeFiles: 0,
      deletedFiles: 0,
    };

    for (const record of this._files.values()) {
      if (record.status === "deleted") {
        stats.deletedFiles++;
        continue;
      }
      stats.totalFiles++;
      stats.activeFiles++;
      stats.totalSizeBytes += record.sizeBytes;

      if (!stats.byCategory[record.category]) {
        stats.byCategory[record.category] = { count: 0, sizeBytes: 0 };
      }
      stats.byCategory[record.category].count++;
      stats.byCategory[record.category].sizeBytes += record.sizeBytes;
    }

    stats.totalSizeMB = +(stats.totalSizeBytes / (1024 * 1024)).toFixed(2);
    return stats;
  }

  _toPublic(record) {
    const { _buffer, ...pub } = record;
    return { ...pub };
  }

  _reset() {
    this._files.clear();
    this._nextId = 1;
  }
}

// ─── High-Level Upload Handler ───────────────────────────────────

export function processUpload(store, params) {
  const {
    originalName, mimeType, sizeBytes, buffer,
    category, entityType, entityId, uploadedBy, description,
  } = params;

  // 1. Validate category
  if (!UPLOAD_CATEGORIES[category]) {
    return { success: false, error: `Unknown upload category: '${category}'` };
  }

  // 2. Sanitise filename
  const { safe: sanitisedName, error: nameError } = sanitiseFilename(originalName);
  if (nameError) {
    return { success: false, error: nameError };
  }

  // 3. Validate MIME type
  const { valid: mimeValid, error: mimeError } = validateMimeType(mimeType, category);
  if (!mimeValid) {
    return { success: false, error: mimeError };
  }

  // 4. Validate file size
  const { valid: sizeValid, error: sizeError } = validateFileSize(sizeBytes, category);
  if (!sizeValid) {
    return { success: false, error: sizeError };
  }

  // 5. Generate storage key
  const storageKey = generateStorageKey(category, sanitisedName);

  // 6. Register
  const file = store.register({
    originalName,
    sanitisedName,
    storageKey,
    mimeType,
    sizeBytes,
    category,
    entityType,
    entityId,
    uploadedBy,
    description,
    buffer,
  });

  return { success: true, file };
}

// ─── Multer Configuration Factory ────────────────────────────────

export function createFileFilter(category) {
  return function fileFilter(req, file, cb) {
    const { valid, error } = validateMimeType(file.mimetype, category);
    if (!valid) {
      return cb(new Error(error), false);
    }

    const { safe, error: nameErr } = sanitiseFilename(file.originalname);
    if (nameErr) {
      return cb(new Error(nameErr), false);
    }

    cb(null, true);
  };
}

export function getSizeLimitBytes(category) {
  const config = UPLOAD_CATEGORIES[category];
  if (!config) return 10 * 1024 * 1024; // default 10MB
  return config.maxSizeMB * 1024 * 1024;
}
