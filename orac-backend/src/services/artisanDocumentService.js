/**
 * Artisan Certification Document Storage Service.
 *
 * Manages the metadata and lifecycle for artisan certification
 * documents: journeyman cards, trade certificates, safety certs,
 * medical fitness, and site induction records.
 *
 * File storage is abstracted — this service tracks metadata, status,
 * and expiry. Actual binary upload uses whatever file transport is
 * configured (Multer for local, S3 for cloud, etc.).
 *
 * Features:
 *  - registerDocument(): Record a new cert document with metadata
 *  - verifyDocument(): Mark document as verified by Admin/HR
 *  - rejectDocument(): Reject with reason (poor scan, expired, etc.)
 *  - getDocumentsForArtisan(): Full document portfolio for a technician
 *  - checkComplianceStatus(): Is this artisan cleared to work?
 *  - getExpiringDocuments(): Documents expiring within N days
 *
 * Zero-dependency. Works with the in-memory db.
 */

import crypto from "node:crypto";

// ── Document Types ──────────────────────────────────────────────────

export const DOCUMENT_TYPES = {
  journeyman_card:     { label: "Journeyman Card",         required: true,  hasExpiry: true },
  trade_certificate:   { label: "Trade Certificate",       required: true,  hasExpiry: false },
  safety_certificate:  { label: "Safety Certificate",      required: true,  hasExpiry: true },
  medical_fitness:     { label: "Medical Fitness",          required: true,  hasExpiry: true },
  first_aid:           { label: "First Aid Certificate",    required: false, hasExpiry: true },
  site_induction:      { label: "Site Induction Record",    required: false, hasExpiry: true },
  drivers_licence:     { label: "Driver's Licence",         required: false, hasExpiry: true },
  other:               { label: "Other Certification",      required: false, hasExpiry: false }
};

export const DOC_TYPE_KEYS = Object.keys(DOCUMENT_TYPES);

// ── States ──────────────────────────────────────────────────────────

export const DOC_STATES = ["Uploaded", "Verified", "Rejected", "Expired", "Archived"];

// ── CRUD ────────────────────────────────────────────────────────────

/**
 * Registers a new certification document.
 */
export function registerDocument({
  technicianId, documentType, documentNumber, issueDate, expiryDate,
  issuingAuthority, fileName, fileSize, mimeType, uploadedBy, store, db
}) {
  if (!technicianId) throw Object.assign(new Error("technicianId is required"), { status: 400 });
  if (!documentType) throw Object.assign(new Error("documentType is required"), { status: 400 });
  if (!DOC_TYPE_KEYS.includes(documentType)) {
    throw Object.assign(new Error(`Invalid document type. Must be one of: ${DOC_TYPE_KEYS.join(", ")}`), { status: 400 });
  }
  if (!fileName) throw Object.assign(new Error("fileName is required"), { status: 400 });

  if (!db.artisan_documents) db.artisan_documents = [];

  // Check for duplicate active document of same type for same technician
  const existing = db.artisan_documents.find(d =>
    d.technician_id === technicianId &&
    d.document_type === documentType &&
    d.status !== "Archived" && d.status !== "Rejected"
  );
  if (existing) {
    // Archive the old one
    existing.status = "Archived";
    existing.archived_at = new Date().toISOString();
  }

  const doc = {
    id: `doc_${crypto.randomBytes(8).toString("hex")}`,
    technician_id: technicianId,
    document_type: documentType,
    document_number: documentNumber || null,
    issue_date: issueDate || null,
    expiry_date: expiryDate || null,
    issuing_authority: issuingAuthority || null,
    file_name: fileName,
    file_size: fileSize || null,
    mime_type: mimeType || null,
    status: "Uploaded",
    verified_by: null,
    verified_at: null,
    rejected_by: null,
    rejection_reason: null,
    uploaded_by: uploadedBy || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  db.artisan_documents.push(doc);

  if (store && store.audit) {
    store.audit(db, { id: uploadedBy || "system" }, "artisan_documents", doc.id,
      "DOCUMENT_UPLOADED", null, {
        technician_id: technicianId, document_type: documentType, file_name: fileName
      });
  }

  return doc;
}

/**
 * Verifies a document (Admin/HR review).
 */
export function verifyDocument({ documentId, verifiedBy, store, db }) {
  const doc = findDocument(documentId, db);
  if (doc.status !== "Uploaded") {
    throw Object.assign(new Error(`Cannot verify a ${doc.status} document`), { status: 409 });
  }

  doc.status = "Verified";
  doc.verified_by = verifiedBy;
  doc.verified_at = new Date().toISOString();
  doc.updated_at = new Date().toISOString();

  if (store && store.audit) {
    store.audit(db, { id: verifiedBy }, "artisan_documents", doc.id,
      "DOCUMENT_VERIFIED", null, null);
  }

  return doc;
}

/**
 * Rejects a document with reason.
 */
export function rejectDocument({ documentId, rejectedBy, reason, store, db }) {
  const doc = findDocument(documentId, db);
  if (doc.status !== "Uploaded") {
    throw Object.assign(new Error(`Cannot reject a ${doc.status} document`), { status: 409 });
  }

  doc.status = "Rejected";
  doc.rejected_by = rejectedBy;
  doc.rejection_reason = reason || null;
  doc.updated_at = new Date().toISOString();

  if (store && store.audit) {
    store.audit(db, { id: rejectedBy }, "artisan_documents", doc.id,
      "DOCUMENT_REJECTED", null, { reason });
  }

  return doc;
}

// ── Queries ─────────────────────────────────────────────────────────

/**
 * Returns all documents for a technician, grouped by type.
 */
export function getDocumentsForArtisan({ technicianId, db }) {
  const docs = (db.artisan_documents || [])
    .filter(d => d.technician_id === technicianId)
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

  const portfolio = {};
  for (const [type, config] of Object.entries(DOCUMENT_TYPES)) {
    const typeDocs = docs.filter(d => d.document_type === type);
    const active = typeDocs.find(d => d.status === "Verified" || d.status === "Uploaded");
    portfolio[type] = {
      label: config.label,
      required: config.required,
      hasExpiry: config.hasExpiry,
      active: active || null,
      history: typeDocs,
      status: active
        ? (active.status === "Verified" ? "valid" : "pending_verification")
        : "missing"
    };
  }

  return portfolio;
}

/**
 * Checks if a technician has all required documents verified.
 */
export function checkComplianceStatus({ technicianId, db }) {
  const portfolio = getDocumentsForArtisan({ technicianId, db });
  const issues = [];
  let compliant = true;

  for (const [type, info] of Object.entries(portfolio)) {
    if (!info.required) continue;

    if (info.status === "missing") {
      issues.push({ type, label: info.label, issue: "missing" });
      compliant = false;
    } else if (info.status === "pending_verification") {
      issues.push({ type, label: info.label, issue: "pending_verification" });
      // Still non-compliant until verified
      compliant = false;
    } else if (info.active && info.hasExpiry && info.active.expiry_date) {
      const expiry = new Date(info.active.expiry_date);
      if (expiry < new Date()) {
        issues.push({ type, label: info.label, issue: "expired", expiryDate: info.active.expiry_date });
        compliant = false;
      }
    }
  }

  return { technicianId, compliant, issues };
}

/**
 * Returns documents expiring within N days.
 */
export function getExpiringDocuments({ days = 30, db }) {
  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + days);

  return (db.artisan_documents || [])
    .filter(d => {
      if (d.status !== "Verified" && d.status !== "Uploaded") return false;
      if (!d.expiry_date) return false;
      const exp = new Date(d.expiry_date);
      return exp >= today && exp <= cutoff;
    })
    .sort((a, b) => (a.expiry_date || "").localeCompare(b.expiry_date || ""));
}

// ── Helpers ─────────────────────────────────────────────────────────

function findDocument(documentId, db) {
  const doc = (db.artisan_documents || []).find(d => d.id === documentId);
  if (!doc) throw Object.assign(new Error("Document not found"), { status: 404 });
  return doc;
}
