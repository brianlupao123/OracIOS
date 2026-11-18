/**
 * Tests for Artisan Certification Document Storage Service.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  registerDocument, verifyDocument, rejectDocument,
  getDocumentsForArtisan, checkComplianceStatus, getExpiringDocuments,
  DOCUMENT_TYPES, DOC_TYPE_KEYS, DOC_STATES
} from "../src/services/artisanDocumentService.js";

function makeDb() { return { artisan_documents: [] }; }
function makeStore() {
  const log = [];
  return { audit: (db, actor, col, id, action) => log.push({ action }), _log: log };
}

const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().split("T")[0]; };
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split("T")[0]; };

// ═══════════════════ Constants ═══════════════════

describe("artisanDocumentService — constants", () => {
  it("defines 8 document types", () => {
    assert.equal(DOC_TYPE_KEYS.length, 8);
    assert.ok(DOC_TYPE_KEYS.includes("journeyman_card"));
    assert.ok(DOC_TYPE_KEYS.includes("trade_certificate"));
    assert.ok(DOC_TYPE_KEYS.includes("safety_certificate"));
    assert.ok(DOC_TYPE_KEYS.includes("medical_fitness"));
  });

  it("marks 4 types as required", () => {
    const required = DOC_TYPE_KEYS.filter(k => DOCUMENT_TYPES[k].required);
    assert.equal(required.length, 4);
  });

  it("defines 5 document states", () => {
    assert.equal(DOC_STATES.length, 5);
  });
});

// ═══════════════════ registerDocument ═══════════════════

describe("artisanDocumentService — registerDocument", () => {
  it("registers a document in Uploaded state", () => {
    const db = makeDb();
    const store = makeStore();
    const doc = registerDocument({
      technicianId: "tech-1", documentType: "journeyman_card",
      documentNumber: "JM-2024-001", issueDate: "2024-01-15",
      expiryDate: "2027-01-15", issuingAuthority: "HEXCO Zimbabwe",
      fileName: "journeyman_card_scan.pdf", fileSize: 245000,
      mimeType: "application/pdf", uploadedBy: "hr-1", store, db
    });

    assert.ok(doc.id.startsWith("doc_"));
    assert.equal(doc.status, "Uploaded");
    assert.equal(doc.technician_id, "tech-1");
    assert.equal(doc.document_type, "journeyman_card");
    assert.equal(doc.file_name, "journeyman_card_scan.pdf");
    assert.equal(db.artisan_documents.length, 1);
  });

  it("archives previous document of same type", () => {
    const db = makeDb();
    const doc1 = registerDocument({
      technicianId: "tech-1", documentType: "journeyman_card",
      fileName: "old_scan.pdf", db
    });

    const doc2 = registerDocument({
      technicianId: "tech-1", documentType: "journeyman_card",
      fileName: "new_scan.pdf", db
    });

    assert.equal(doc1.status, "Archived");
    assert.equal(doc2.status, "Uploaded");
    assert.equal(db.artisan_documents.length, 2);
  });

  it("rejects invalid document type", () => {
    const db = makeDb();
    assert.throws(
      () => registerDocument({ technicianId: "tech-1", documentType: "phd_thesis", fileName: "f.pdf", db }),
      /Invalid document type/
    );
  });

  it("rejects missing fileName", () => {
    const db = makeDb();
    assert.throws(
      () => registerDocument({ technicianId: "tech-1", documentType: "journeyman_card", db }),
      /fileName is required/
    );
  });

  it("rejects missing technicianId", () => {
    const db = makeDb();
    assert.throws(
      () => registerDocument({ documentType: "journeyman_card", fileName: "f.pdf", db }),
      /technicianId is required/
    );
  });
});

// ═══════════════════ verifyDocument / rejectDocument ═══════════════════

describe("artisanDocumentService — verifyDocument", () => {
  it("verifies an uploaded document", () => {
    const db = makeDb();
    const store = makeStore();
    const doc = registerDocument({
      technicianId: "tech-1", documentType: "safety_certificate",
      fileName: "cert.pdf", store, db
    });

    const verified = verifyDocument({ documentId: doc.id, verifiedBy: "hr-1", store, db });
    assert.equal(verified.status, "Verified");
    assert.equal(verified.verified_by, "hr-1");
    assert.ok(verified.verified_at);
  });

  it("throws 409 for non-Uploaded document", () => {
    const db = makeDb();
    const store = makeStore();
    const doc = registerDocument({ technicianId: "tech-1", documentType: "safety_certificate", fileName: "cert.pdf", store, db });
    verifyDocument({ documentId: doc.id, verifiedBy: "hr-1", store, db });

    assert.throws(
      () => verifyDocument({ documentId: doc.id, verifiedBy: "hr-1", store, db }),
      /Cannot verify/
    );
  });
});

describe("artisanDocumentService — rejectDocument", () => {
  it("rejects with reason", () => {
    const db = makeDb();
    const store = makeStore();
    const doc = registerDocument({ technicianId: "tech-1", documentType: "medical_fitness", fileName: "med.pdf", store, db });

    const rejected = rejectDocument({
      documentId: doc.id, rejectedBy: "hr-1",
      reason: "Scan is illegible", store, db
    });

    assert.equal(rejected.status, "Rejected");
    assert.equal(rejected.rejection_reason, "Scan is illegible");
  });

  it("throws 404 for unknown document", () => {
    const db = makeDb();
    assert.throws(
      () => verifyDocument({ documentId: "doc_unknown", verifiedBy: "hr-1", db }),
      /not found/
    );
  });
});

// ═══════════════════ getDocumentsForArtisan ═══════════════════

describe("artisanDocumentService — getDocumentsForArtisan", () => {
  it("returns portfolio grouped by document type", () => {
    const db = makeDb();
    const store = makeStore();
    registerDocument({ technicianId: "tech-1", documentType: "journeyman_card", fileName: "jm.pdf", store, db });
    const cert = registerDocument({ technicianId: "tech-1", documentType: "safety_certificate", fileName: "sc.pdf", store, db });
    verifyDocument({ documentId: cert.id, verifiedBy: "hr-1", store, db });

    const portfolio = getDocumentsForArtisan({ technicianId: "tech-1", db });

    assert.equal(portfolio.journeyman_card.status, "pending_verification");
    assert.equal(portfolio.safety_certificate.status, "valid");
    assert.equal(portfolio.trade_certificate.status, "missing");
    assert.equal(Object.keys(portfolio).length, 8);
  });
});

// ═══════════════════ checkComplianceStatus ═══════════════════

describe("artisanDocumentService — checkComplianceStatus", () => {
  it("returns non-compliant when required documents are missing", () => {
    const db = makeDb();
    const result = checkComplianceStatus({ technicianId: "tech-1", db });

    assert.equal(result.compliant, false);
    assert.equal(result.issues.length, 4);  // 4 required types missing
    assert.ok(result.issues.every(i => i.issue === "missing"));
  });

  it("returns compliant when all required docs are verified", () => {
    const db = makeDb();
    const store = makeStore();

    // Upload and verify all 4 required types
    for (const type of ["journeyman_card", "trade_certificate", "safety_certificate", "medical_fitness"]) {
      const doc = registerDocument({ technicianId: "tech-1", documentType: type, fileName: `${type}.pdf`, store, db });
      verifyDocument({ documentId: doc.id, verifiedBy: "hr-1", store, db });
    }

    const result = checkComplianceStatus({ technicianId: "tech-1", db });
    assert.equal(result.compliant, true);
    assert.equal(result.issues.length, 0);
  });

  it("flags expired verified documents", () => {
    const db = makeDb();
    const store = makeStore();

    const doc = registerDocument({
      technicianId: "tech-1", documentType: "safety_certificate",
      fileName: "sc.pdf", expiryDate: daysAgo(10), store, db
    });
    verifyDocument({ documentId: doc.id, verifiedBy: "hr-1", store, db });

    // Add other required docs as verified
    for (const type of ["journeyman_card", "trade_certificate", "medical_fitness"]) {
      const d = registerDocument({ technicianId: "tech-1", documentType: type, fileName: `${type}.pdf`, store, db });
      verifyDocument({ documentId: d.id, verifiedBy: "hr-1", store, db });
    }

    const result = checkComplianceStatus({ technicianId: "tech-1", db });
    assert.equal(result.compliant, false);
    assert.ok(result.issues.some(i => i.type === "safety_certificate" && i.issue === "expired"));
  });

  it("flags pending_verification as non-compliant", () => {
    const db = makeDb();
    const store = makeStore();

    // Upload but don't verify
    registerDocument({ technicianId: "tech-1", documentType: "journeyman_card", fileName: "jm.pdf", store, db });
    // Verify the rest
    for (const type of ["trade_certificate", "safety_certificate", "medical_fitness"]) {
      const d = registerDocument({ technicianId: "tech-1", documentType: type, fileName: `${type}.pdf`, store, db });
      verifyDocument({ documentId: d.id, verifiedBy: "hr-1", store, db });
    }

    const result = checkComplianceStatus({ technicianId: "tech-1", db });
    assert.equal(result.compliant, false);
    assert.ok(result.issues.some(i => i.issue === "pending_verification"));
  });
});

// ═══════════════════ getExpiringDocuments ═══════════════════

describe("artisanDocumentService — getExpiringDocuments", () => {
  it("returns documents expiring within N days", () => {
    const db = makeDb();
    const store = makeStore();

    // Expiring in 15 days
    const doc1 = registerDocument({
      technicianId: "tech-1", documentType: "safety_certificate",
      fileName: "sc.pdf", expiryDate: daysFromNow(15), store, db
    });
    verifyDocument({ documentId: doc1.id, verifiedBy: "hr-1", store, db });

    // Expiring in 90 days (should not be in 30-day window)
    const doc2 = registerDocument({
      technicianId: "tech-2", documentType: "medical_fitness",
      fileName: "mf.pdf", expiryDate: daysFromNow(90), store, db
    });
    verifyDocument({ documentId: doc2.id, verifiedBy: "hr-1", store, db });

    const expiring = getExpiringDocuments({ days: 30, db });
    assert.equal(expiring.length, 1);
    assert.equal(expiring[0].technician_id, "tech-1");
  });

  it("excludes already expired documents", () => {
    const db = makeDb();
    const store = makeStore();

    const doc = registerDocument({
      technicianId: "tech-1", documentType: "first_aid",
      fileName: "fa.pdf", expiryDate: daysAgo(5), store, db
    });
    verifyDocument({ documentId: doc.id, verifiedBy: "hr-1", store, db });

    const expiring = getExpiringDocuments({ days: 30, db });
    assert.equal(expiring.length, 0);
  });

  it("excludes rejected/archived documents", () => {
    const db = makeDb();
    const store = makeStore();

    const doc = registerDocument({
      technicianId: "tech-1", documentType: "first_aid",
      fileName: "fa.pdf", expiryDate: daysFromNow(10), store, db
    });
    rejectDocument({ documentId: doc.id, rejectedBy: "hr-1", reason: "Bad scan", store, db });

    const expiring = getExpiringDocuments({ days: 30, db });
    assert.equal(expiring.length, 0);
  });
});
