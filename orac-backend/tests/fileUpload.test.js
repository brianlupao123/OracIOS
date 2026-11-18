/**
 * Tests for ORAC File Upload Service.
 * 45 tests covering filename sanitisation, MIME validation, size limits,
 * storage keys, store CRUD, end-to-end processUpload, Multer helpers, config.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  sanitiseFilename,
  validateMimeType,
  validateFileSize,
  generateStorageKey,
  FileUploadStore,
  processUpload,
  createFileFilter,
  getSizeLimitBytes,
  UPLOAD_CATEGORIES,
  DANGEROUS_EXTENSIONS,
} from "../src/services/fileUploadService.js";

// ═══════════════════════════════════════════════════════════════════
// 1. Filename Sanitisation
// ═══════════════════════════════════════════════════════════════════

describe("FileUpload — Filename Sanitisation", () => {
  it("passes through a normal filename", () => {
    const { safe, error } = sanitiseFilename("report.pdf");
    assert.equal(error, null);
    assert.equal(safe, "report.pdf");
  });

  it("strips directory traversal attempts", () => {
    const { safe, error } = sanitiseFilename("../../etc/passwd");
    assert.equal(error, null);
    assert.equal(safe, "passwd");
  });

  it("strips Windows path separators", () => {
    const { safe, error } = sanitiseFilename("C:\\Users\\evil\\payload.pdf");
    assert.equal(error, null);
    assert.equal(safe, "payload.pdf");
  });

  it("removes null bytes", () => {
    const { safe, error } = sanitiseFilename("file\x00name.pdf");
    assert.equal(error, null);
    assert.equal(safe, "filename.pdf");
  });

  it("replaces special characters with underscores", () => {
    const { safe, error } = sanitiseFilename('file<name>:test.pdf');
    assert.equal(error, null);
    assert.match(safe, /file_name__test\.pdf/);
  });

  it("rejects dangerous extensions (.exe)", () => {
    const { safe, error } = sanitiseFilename("virus.exe");
    assert.equal(safe, null);
    assert.match(error, /\.exe.*not allowed/);
  });

  it("rejects dangerous extensions (.bat)", () => {
    const { safe, error } = sanitiseFilename("script.bat");
    assert.equal(safe, null);
    assert.match(error, /\.bat.*not allowed/);
  });

  it("rejects dangerous extensions (.ps1)", () => {
    const { safe, error } = sanitiseFilename("pwn.ps1");
    assert.equal(safe, null);
    assert.match(error, /\.ps1.*not allowed/);
  });

  it("truncates overly long filenames preserving extension", () => {
    const longName = "a".repeat(250) + ".pdf";
    const { safe, error } = sanitiseFilename(longName);
    assert.equal(error, null);
    assert.ok(safe.length <= 200);
    assert.ok(safe.endsWith(".pdf"));
  });

  it("returns error for empty string", () => {
    const { safe, error } = sanitiseFilename("");
    assert.equal(safe, null);
    assert.match(error, /Missing filename/);
  });

  it("returns error for null input", () => {
    const { safe, error } = sanitiseFilename(null);
    assert.equal(safe, null);
    assert.match(error, /Missing filename/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. MIME Type Validation
// ═══════════════════════════════════════════════════════════════════

describe("FileUpload — MIME Validation", () => {
  it("accepts PDF for artisan_document", () => {
    const { valid, error } = validateMimeType("application/pdf", "artisan_document");
    assert.equal(valid, true);
    assert.equal(error, null);
  });

  it("accepts JPEG for fleet_photo", () => {
    const { valid } = validateMimeType("image/jpeg", "fleet_photo");
    assert.equal(valid, true);
  });

  it("rejects ZIP for artisan_document", () => {
    const { valid, error } = validateMimeType("application/zip", "artisan_document");
    assert.equal(valid, false);
    assert.match(error, /not allowed.*artisan_document/);
  });

  it("rejects unknown category", () => {
    const { valid, error } = validateMimeType("application/pdf", "nonexistent");
    assert.equal(valid, false);
    assert.match(error, /Unknown upload category/);
  });

  it("normalises MIME case", () => {
    const { valid } = validateMimeType("Application/PDF", "artisan_document");
    assert.equal(valid, true);
  });

  it("rejects missing MIME", () => {
    const { valid, error } = validateMimeType(null, "general");
    assert.equal(valid, false);
    assert.match(error, /Missing MIME/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. File Size Validation
// ═══════════════════════════════════════════════════════════════════

describe("FileUpload — Size Validation", () => {
  it("accepts file within limit", () => {
    const { valid, error } = validateFileSize(5 * 1024 * 1024, "artisan_document");
    assert.equal(valid, true);
    assert.equal(error, null);
  });

  it("rejects file over limit", () => {
    const { valid, error } = validateFileSize(11 * 1024 * 1024, "artisan_document");
    assert.equal(valid, false);
    assert.match(error, /exceeds.*10MB/);
  });

  it("returns correct limit for fleet_photo (15MB)", () => {
    const { limitMB } = validateFileSize(1024, "fleet_photo");
    assert.equal(limitMB, 15);
  });

  it("rejects zero size", () => {
    const { valid, error } = validateFileSize(0, "general");
    assert.equal(valid, false);
    assert.match(error, /Invalid file size/);
  });

  it("rejects negative size", () => {
    const { valid } = validateFileSize(-100, "general");
    assert.equal(valid, false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. Storage Key Generation
// ═══════════════════════════════════════════════════════════════════

describe("FileUpload — Storage Key", () => {
  it("generates key with category prefix", () => {
    const key = generateStorageKey("artisan_document", "cert.pdf");
    assert.ok(key.startsWith("artisan_document/"));
    assert.ok(key.endsWith("_cert.pdf"));
  });

  it("includes year/month in path", () => {
    const key = generateStorageKey("fleet_photo", "truck.jpg");
    const parts = key.split("/");
    assert.equal(parts.length, 4);
    assert.match(parts[1], /^\d{4}$/);
    assert.match(parts[2], /^\d{2}$/);
  });

  it("generates unique keys for same filename", () => {
    const key1 = generateStorageKey("general", "doc.pdf");
    const key2 = generateStorageKey("general", "doc.pdf");
    assert.notEqual(key1, key2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. FileUploadStore
// ═══════════════════════════════════════════════════════════════════

describe("FileUpload — Store", () => {
  let store;

  beforeEach(() => {
    store = new FileUploadStore();
  });

  it("registers a file and returns public record", () => {
    const record = store.register({
      originalName: "cert.pdf",
      sanitisedName: "cert.pdf",
      storageKey: "artisan_document/2026/11/abc_cert.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      category: "artisan_document",
      entityType: "technician",
      entityId: "tech-001",
      uploadedBy: "admin-001",
      description: "Trade certificate",
    });

    assert.ok(record.id);
    assert.equal(record.originalName, "cert.pdf");
    assert.equal(record.status, "active");
    assert.equal(record.description, "Trade certificate");
    assert.equal(record._buffer, undefined); // buffer stripped from public view
  });

  it("retrieves file by ID", () => {
    const created = store.register({
      originalName: "doc.pdf", sanitisedName: "doc.pdf",
      storageKey: "general/2026/11/x_doc.pdf", mimeType: "application/pdf",
      sizeBytes: 512, category: "general", entityType: "dispatch",
      entityId: "d-001", uploadedBy: "user-1",
    });

    const found = store.getById(created.id);
    assert.equal(found.id, created.id);
    assert.equal(found.originalName, "doc.pdf");
  });

  it("returns null for nonexistent ID", () => {
    assert.equal(store.getById("999"), null);
  });

  it("lists files by entity", () => {
    store.register({
      originalName: "a.pdf", sanitisedName: "a.pdf",
      storageKey: "general/2026/11/a.pdf", mimeType: "application/pdf",
      sizeBytes: 100, category: "general", entityType: "technician",
      entityId: "tech-1", uploadedBy: "u1",
    });
    store.register({
      originalName: "b.pdf", sanitisedName: "b.pdf",
      storageKey: "general/2026/11/b.pdf", mimeType: "application/pdf",
      sizeBytes: 200, category: "general", entityType: "technician",
      entityId: "tech-1", uploadedBy: "u1",
    });
    store.register({
      originalName: "c.pdf", sanitisedName: "c.pdf",
      storageKey: "general/2026/11/c.pdf", mimeType: "application/pdf",
      sizeBytes: 300, category: "general", entityType: "technician",
      entityId: "tech-2", uploadedBy: "u1",
    });

    const list = store.listByEntity("technician", "tech-1");
    assert.equal(list.length, 2);
  });

  it("filters entity files by category", () => {
    store.register({
      originalName: "a.pdf", sanitisedName: "a.pdf",
      storageKey: "artisan_document/2026/11/a.pdf", mimeType: "application/pdf",
      sizeBytes: 100, category: "artisan_document", entityType: "technician",
      entityId: "tech-1", uploadedBy: "u1",
    });
    store.register({
      originalName: "b.jpg", sanitisedName: "b.jpg",
      storageKey: "fleet_photo/2026/11/b.jpg", mimeType: "image/jpeg",
      sizeBytes: 200, category: "fleet_photo", entityType: "technician",
      entityId: "tech-1", uploadedBy: "u1",
    });

    const artisanOnly = store.listByEntity("technician", "tech-1", { category: "artisan_document" });
    assert.equal(artisanOnly.length, 1);
    assert.equal(artisanOnly[0].category, "artisan_document");
  });

  it("soft-deletes a file", () => {
    const created = store.register({
      originalName: "x.pdf", sanitisedName: "x.pdf",
      storageKey: "general/2026/11/x.pdf", mimeType: "application/pdf",
      sizeBytes: 100, category: "general", entityType: "dispatch",
      entityId: "d-1", uploadedBy: "u1",
    });

    const deleted = store.softDelete(created.id, "admin-1");
    assert.equal(deleted.status, "deleted");
    assert.ok(deleted.deletedAt);
    assert.equal(deleted.deletedBy, "admin-1");

    // No longer retrievable
    assert.equal(store.getById(created.id), null);
  });

  it("returns null when soft-deleting nonexistent file", () => {
    assert.equal(store.softDelete("999", "admin"), null);
  });

  it("computes stats correctly", () => {
    store.register({
      originalName: "a.pdf", sanitisedName: "a.pdf",
      storageKey: "general/2026/11/a.pdf", mimeType: "application/pdf",
      sizeBytes: 1000, category: "general", entityType: "x",
      entityId: "1", uploadedBy: "u1",
    });
    store.register({
      originalName: "b.jpg", sanitisedName: "b.jpg",
      storageKey: "fleet_photo/2026/11/b.jpg", mimeType: "image/jpeg",
      sizeBytes: 2000, category: "fleet_photo", entityType: "x",
      entityId: "1", uploadedBy: "u1",
    });

    const stats = store.getStats();
    assert.equal(stats.totalFiles, 2);
    assert.equal(stats.activeFiles, 2);
    assert.equal(stats.totalSizeBytes, 3000);
    assert.equal(stats.byCategory.general.count, 1);
    assert.equal(stats.byCategory.fleet_photo.count, 1);
  });

  it("stats exclude deleted files from active count", () => {
    const r = store.register({
      originalName: "a.pdf", sanitisedName: "a.pdf",
      storageKey: "general/2026/11/a.pdf", mimeType: "application/pdf",
      sizeBytes: 500, category: "general", entityType: "x",
      entityId: "1", uploadedBy: "u1",
    });
    store.softDelete(r.id, "admin");

    const stats = store.getStats();
    assert.equal(stats.activeFiles, 0);
    assert.equal(stats.deletedFiles, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. processUpload (End-to-End)
// ═══════════════════════════════════════════════════════════════════

describe("FileUpload — processUpload", () => {
  let store;

  beforeEach(() => {
    store = new FileUploadStore();
  });

  it("processes a valid upload end-to-end", () => {
    const result = processUpload(store, {
      originalName: "trade_cert.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2 * 1024 * 1024,
      buffer: Buffer.from("fake-pdf-content"),
      category: "artisan_document",
      entityType: "technician",
      entityId: "tech-001",
      uploadedBy: "admin-001",
      description: "Journeyman card scan",
    });

    assert.equal(result.success, true);
    assert.ok(result.file);
    assert.equal(result.file.sanitisedName, "trade_cert.pdf");
    assert.equal(result.file.category, "artisan_document");
    assert.equal(result.file.description, "Journeyman card scan");
  });

  it("rejects upload with invalid category", () => {
    const result = processUpload(store, {
      originalName: "doc.pdf", mimeType: "application/pdf",
      sizeBytes: 1024, buffer: Buffer.alloc(0),
      category: "nonexistent", entityType: "x", entityId: "1", uploadedBy: "u1",
    });
    assert.equal(result.success, false);
    assert.match(result.error, /Unknown upload category/);
  });

  it("rejects upload with dangerous filename", () => {
    const result = processUpload(store, {
      originalName: "malware.exe", mimeType: "application/pdf",
      sizeBytes: 1024, buffer: Buffer.alloc(0),
      category: "general", entityType: "x", entityId: "1", uploadedBy: "u1",
    });
    assert.equal(result.success, false);
    assert.match(result.error, /\.exe.*not allowed/);
  });

  it("rejects upload with wrong MIME for category", () => {
    const result = processUpload(store, {
      originalName: "photo.zip", mimeType: "application/zip",
      sizeBytes: 1024, buffer: Buffer.alloc(0),
      category: "fleet_photo", entityType: "vehicle", entityId: "v-1", uploadedBy: "u1",
    });
    assert.equal(result.success, false);
    assert.match(result.error, /not allowed.*fleet_photo/);
  });

  it("rejects upload exceeding size limit", () => {
    const result = processUpload(store, {
      originalName: "huge.pdf", mimeType: "application/pdf",
      sizeBytes: 30 * 1024 * 1024,
      buffer: Buffer.alloc(0),
      category: "artisan_document", entityType: "technician", entityId: "t-1", uploadedBy: "u1",
    });
    assert.equal(result.success, false);
    assert.match(result.error, /exceeds.*10MB/);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Multer Helpers
// ═══════════════════════════════════════════════════════════════════

describe("FileUpload — Multer Helpers", () => {
  it("createFileFilter accepts valid file", (_, done) => {
    const filter = createFileFilter("artisan_document");
    const fakeFile = { mimetype: "application/pdf", originalname: "cert.pdf" };
    filter(null, fakeFile, (err, accepted) => {
      assert.equal(err, null);
      assert.equal(accepted, true);
      done();
    });
  });

  it("createFileFilter rejects invalid MIME", (_, done) => {
    const filter = createFileFilter("fleet_photo");
    const fakeFile = { mimetype: "application/pdf", originalname: "doc.pdf" };
    filter(null, fakeFile, (err, _accepted) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /not allowed/);
      done();
    });
  });

  it("createFileFilter rejects dangerous filename", (_, done) => {
    const filter = createFileFilter("general");
    const fakeFile = { mimetype: "application/pdf", originalname: "hack.exe" };
    filter(null, fakeFile, (err, _accepted) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /\.exe.*not allowed/);
      done();
    });
  });

  it("getSizeLimitBytes returns correct limit for artisan_document", () => {
    assert.equal(getSizeLimitBytes("artisan_document"), 10 * 1024 * 1024);
  });

  it("getSizeLimitBytes returns correct limit for dispatch_attachment", () => {
    assert.equal(getSizeLimitBytes("dispatch_attachment"), 25 * 1024 * 1024);
  });

  it("getSizeLimitBytes returns default for unknown category", () => {
    assert.equal(getSizeLimitBytes("nonexistent"), 10 * 1024 * 1024);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Configuration Constants
// ═══════════════════════════════════════════════════════════════════

describe("FileUpload — Configuration", () => {
  it("has 6 upload categories defined", () => {
    assert.equal(Object.keys(UPLOAD_CATEGORIES).length, 6);
  });

  it("all categories have maxSizeMB and allowedMimes", () => {
    for (const [name, config] of Object.entries(UPLOAD_CATEGORIES)) {
      assert.ok(typeof config.maxSizeMB === "number", `${name} missing maxSizeMB`);
      assert.ok(Array.isArray(config.allowedMimes), `${name} missing allowedMimes`);
      assert.ok(config.allowedMimes.length > 0, `${name} has empty allowedMimes`);
    }
  });

  it("dangerous extensions set includes common threats", () => {
    assert.ok(DANGEROUS_EXTENSIONS.has(".exe"));
    assert.ok(DANGEROUS_EXTENSIONS.has(".bat"));
    assert.ok(DANGEROUS_EXTENSIONS.has(".ps1"));
    assert.ok(DANGEROUS_EXTENSIONS.has(".php"));
    assert.ok(DANGEROUS_EXTENSIONS.has(".jsp"));
  });
});
