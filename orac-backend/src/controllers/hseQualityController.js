/**
 * hseQualityController.js — HTTP handlers for HSE JSA + Quality Inspections
 *
 * Routes:
 *   POST   /hse/jsa                                — create a JSA
 *   POST   /hse/jsa/:id/submit                     — submit a JSA for approval
 *   POST   /hse/jsa/:id/approve                    — approve a JSA
 *   POST   /hse/jsa/:id/reject                     — reject a JSA
 *   GET    /hse/jsa/:dispatchId/check               — check if dispatch has approved JSA
 *   POST   /hse/inspections                         — create a quality inspection
 *   POST   /hse/inspections/:id/results             — record inspection results
 *   POST   /hse/inspections/:id/submit              — submit inspection
 *   POST   /hse/inspections/:id/sign-off            — QA sign-off
 */

import {
  createJsa,
  submitJsa,
  approveJsa,
  rejectJsa,
  hasApprovedJsa,
  createInspection,
  recordInspectionResults,
  submitInspection,
  signOffInspection,
} from "../services/hseQualityService.js";

function getDb(req) {
  return req.db || req.store?.db || req.app?.locals?.store?.db || req.app?.locals?.db;
}

function resolveActor(req) {
  if (!req.user?.id) {
    const err = new Error("Authentication required");
    err.status = 401;
    throw err;
  }
  return req.user;
}

export function postCreateJsa(req, res) {
  try {
    const actor = resolveActor(req);
    const db = getDb(req);
    const jsa = createJsa({
      dispatchId: req.body.dispatchId,
      assessedBy: actor.id,
      jobDescription: req.body.jobDescription,
      location: req.body.location,
      hazardSteps: req.body.hazardSteps,
      db,
    });
    res.status(201).json({ ok: true, jsa });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function postSubmitJsa(req, res) {
  try {
    const actor = resolveActor(req);
    const db = getDb(req);
    const jsa = submitJsa({
      jsaId: req.params.id,
      userId: actor.id,
      db,
    });
    res.json({ ok: true, jsa });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function postApproveJsa(req, res) {
  try {
    const actor = resolveActor(req);
    const allowed = ["Admin", "Management", "Operations", "Supervisor", "HSE & Quality"].includes(actor.role);
    if (!allowed) {
      return res.status(403).json({ ok: false, error: "Not authorized to approve JSA" });
    }

    const db = getDb(req);
    const jsa = approveJsa({
      jsaId: req.params.id,
      approvedBy: actor.id,
      db,
    });
    res.json({ ok: true, jsa });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function postRejectJsa(req, res) {
  try {
    const actor = resolveActor(req);
    const allowed = ["Admin", "Management", "Operations", "Supervisor", "HSE & Quality"].includes(actor.role);
    if (!allowed) {
      return res.status(403).json({ ok: false, error: "Not authorized to reject JSA" });
    }

    const db = getDb(req);
    const jsa = rejectJsa({
      jsaId: req.params.id,
      rejectedBy: actor.id,
      reason: req.body.reason,
      db,
    });
    res.json({ ok: true, jsa });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function getJsaCheck(req, res) {
  try {
    const db = getDb(req);
    const approved = hasApprovedJsa({
      dispatchId: req.params.dispatchId,
      db,
    });
    res.json({ ok: true, approved });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function postCreateInspection(req, res) {
  try {
    const actor = resolveActor(req);
    const db = getDb(req);
    const inspection = createInspection({
      dispatchId: req.body.dispatchId,
      inspectorId: actor.id,
      inspectionType: req.body.inspectionType,
      checklistItems: req.body.checklistItems,
      db,
    });
    res.status(201).json({ ok: true, inspection });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function postRecordResults(req, res) {
  try {
    resolveActor(req);
    const db = getDb(req);
    const inspection = recordInspectionResults({
      inspectionId: req.params.id,
      results: req.body.results,
      db,
    });
    res.json({ ok: true, inspection });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function postSubmitInspection(req, res) {
  try {
    const actor = resolveActor(req);
    const db = getDb(req);
    const inspection = submitInspection({
      inspectionId: req.params.id,
      userId: actor.id,
      db,
    });
    res.json({ ok: true, inspection });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}

export function postSignOff(req, res) {
  try {
    const actor = resolveActor(req);
    const allowed = ["Admin", "Management", "Operations", "HSE & Quality"].includes(actor.role);
    if (!allowed) {
      return res.status(403).json({ ok: false, error: "Not authorized to sign off quality inspection" });
    }

    const db = getDb(req);
    const inspection = signOffInspection({
      inspectionId: req.params.id,
      signedOffBy: actor.id,
      db,
    });
    res.json({ ok: true, inspection });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
}
