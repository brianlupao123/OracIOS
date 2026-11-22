/**
 * artisanDocumentController.js — HTTP handlers for Artisan Document Storage
 *
 * Routes:
 *   POST   /artisan/documents                       — register a document
 *   POST   /artisan/documents/:id/verify             — verify a document
 *   POST   /artisan/documents/:id/reject             — reject a document
 *   GET    /artisan/:technicianId/portfolio           — get all docs for an artisan
 *   GET    /artisan/:technicianId/compliance          — check compliance status
 *   GET    /artisan/documents/expiring                — list expiring documents
 */

import {
  registerDocument,
  verifyDocument,
  rejectDocument,
  getDocumentsForArtisan,
  checkComplianceStatus,
  getExpiringDocuments,
} from "../services/artisanDocumentService.js";

function getStoreAndDb(req) {
  const store = req.store || req.app?.locals?.store;
  const db = req.db || store?.db || req.app?.locals?.db;
  return { store, db };
}

export function postRegisterDocument(req, res) {
  try {
    const { store, db } = getStoreAndDb(req);
    const doc = registerDocument({
      technicianId: req.body.technicianId,
      documentType: req.body.documentType,
      documentNumber: req.body.documentNumber,
      issueDate: req.body.issueDate,
      expiryDate: req.body.expiryDate,
      issuingAuthority: req.body.issuingAuthority,
      fileName: req.body.fileName || req.file?.originalname,
      fileSize: req.body.fileSize || req.file?.size,
      mimeType: req.body.mimeType || req.file?.mimetype,
      uploadedBy: req.user?.id || req.body.uploadedBy,
      store,
      db,
    });
    res.status(201).json({ ok: true, document: doc });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function postVerifyDocument(req, res) {
  try {
    const { store, db } = getStoreAndDb(req);
    const doc = verifyDocument({
      documentId: req.params.id,
      verifiedBy: req.user?.id || req.body.verifiedBy,
      store,
      db,
    });
    res.json({ ok: true, document: doc });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function postRejectDocument(req, res) {
  try {
    const { store, db } = getStoreAndDb(req);
    const doc = rejectDocument({
      documentId: req.params.id,
      rejectedBy: req.user?.id || req.body.rejectedBy,
      reason: req.body.reason,
      store,
      db,
    });
    res.json({ ok: true, document: doc });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function getPortfolio(req, res) {
  try {
    const { db } = getStoreAndDb(req);
    const portfolio = getDocumentsForArtisan({
      technicianId: req.params.technicianId,
      db,
    });
    res.json({ ok: true, portfolio });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function getCompliance(req, res) {
  try {
    const { db } = getStoreAndDb(req);
    const status = checkComplianceStatus({
      technicianId: req.params.technicianId,
      db,
    });
    res.json({ ok: true, compliance: status });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function getExpiring(req, res) {
  try {
    const { db } = getStoreAndDb(req);
    const days = req.query.days ? parseInt(req.query.days, 10) : 30;
    const docs = getExpiringDocuments({ days, db });
    res.json({ ok: true, documents: docs, count: docs.length });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}
