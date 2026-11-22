/**
 * HSE Risk Assessment & Quality Inspection Service.
 *
 * 1. Job Safety Analysis (JSA) — pre-job risk assessments:
 *    - Identify hazards per work step
 *    - Risk matrix scoring (Likelihood × Severity)
 *    - Control measures with responsible persons
 *    - Approval gate: dispatch blocked until JSA approved
 *
 * 2. Quality Inspection Sign-offs — post-job QA/QC:
 *    - Checklist items with pass/fail/NA
 *    - Inspection sign-off with inspector name + date
 *    - Overall verdict: Pass, Conditional, Fail
 *    - Re-inspection workflow for failed items
 *
 * Zero-dependency. Works with the in-memory db.
 */

import crypto from "node:crypto";

// ══════════════════════════════════════════════════════════════════════
// Part 1: Job Safety Analysis (JSA)
// ══════════════════════════════════════════════════════════════════════

const JSA_STATES = ["Draft", "Submitted", "Approved", "Rejected"];
const LIKELIHOOD_LEVELS = ["Rare", "Unlikely", "Possible", "Likely", "Almost_Certain"];
const SEVERITY_LEVELS   = ["Negligible", "Minor", "Moderate", "Major", "Catastrophic"];

// 5×5 risk matrix → risk score (1-25)
function riskScore(likelihood, severity) {
  const l = LIKELIHOOD_LEVELS.indexOf(likelihood);
  const s = SEVERITY_LEVELS.indexOf(severity);
  if (l < 0 || s < 0) return 0;
  return (l + 1) * (s + 1);
}

function riskRating(score) {
  if (score >= 15) return "Extreme";
  if (score >= 10) return "High";
  if (score >= 5)  return "Medium";
  return "Low";
}

/**
 * Creates a JSA for a dispatch/job.
 */
export function createJsa({
  dispatchId, jobDescription, siteLocation, assessedBy, createdBy,
  hazardSteps, store, db
}) {
  if (!dispatchId)      throw Object.assign(new Error("dispatchId is required"),      { status: 400 });
  if (!jobDescription)  throw Object.assign(new Error("jobDescription is required"),  { status: 400 });
  if (!hazardSteps || !Array.isArray(hazardSteps) || hazardSteps.length === 0) {
    throw Object.assign(new Error("At least one hazard step is required"), { status: 400 });
  }

  if (!db.jsa_records) db.jsa_records = [];

  // Validate and score each hazard step
  const steps = hazardSteps.map((step, i) => {
    if (!step.workStep)   throw Object.assign(new Error(`Step ${i + 1}: workStep is required`), { status: 400 });
    if (!step.hazard)     throw Object.assign(new Error(`Step ${i + 1}: hazard is required`),   { status: 400 });
    if (!step.likelihood) throw Object.assign(new Error(`Step ${i + 1}: likelihood is required`), { status: 400 });
    if (!step.severity)   throw Object.assign(new Error(`Step ${i + 1}: severity is required`),   { status: 400 });

    const score = riskScore(step.likelihood, step.severity);
    return {
      step_number: i + 1,
      work_step: step.workStep,
      hazard: step.hazard,
      likelihood: step.likelihood,
      severity: step.severity,
      risk_score: score,
      risk_rating: riskRating(score),
      control_measures: step.controlMeasures || [],
      responsible_person: step.responsiblePerson || null
    };
  });

  const maxScore = Math.max(...steps.map(s => s.risk_score));
  const author = assessedBy || createdBy || null;

  const jsa = {
    id: `jsa_${crypto.randomBytes(8).toString("hex")}`,
    dispatch_id: dispatchId,
    job_description: jobDescription,
    site_location: siteLocation || null,
    assessed_by: author,
    status: "Draft",
    steps,
    overall_risk_score: maxScore,
    overall_risk_rating: riskRating(maxScore),
    approved_by: null,
    approved_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  db.jsa_records.push(jsa);

  if (store && store.audit) {
    store.audit(db, { id: author || "system" }, "jsa_records", jsa.id,
      "JSA_CREATED", null, {
        dispatch_id: dispatchId, steps: steps.length,
        overall_risk: jsa.overall_risk_rating
      });
  }

  return jsa;
}

/**
 * Submit a JSA for approval.
 */
export function submitJsa({ jsaId, userId, submittedBy, store, db }) {
  const actorId = userId || submittedBy || null;
  const jsa = findJsa(jsaId, db);
  if (jsa.status !== "Draft") {
    throw Object.assign(new Error(`Cannot submit a ${jsa.status} JSA`), { status: 409 });
  }
  jsa.status = "Submitted";
  jsa.submitted_by = actorId;
  jsa.updated_at = new Date().toISOString();

  if (store && store.audit) {
    store.audit(db, { id: actorId || "system" }, "jsa_records", jsa.id, "JSA_SUBMITTED", null, null);
  }
  return jsa;
}

/**
 * Approve a JSA. Self-approval blocked.
 */
export function approveJsa({ jsaId, approvedBy, store, db }) {
  const jsa = findJsa(jsaId, db);
  if (jsa.status !== "Submitted") {
    throw Object.assign(new Error(`Cannot approve a ${jsa.status} JSA`), { status: 409 });
  }
  if ((jsa.assessed_by && jsa.assessed_by === approvedBy) || (jsa.submitted_by && jsa.submitted_by === approvedBy)) {
    throw Object.assign(new Error("Self-approval of JSA is not allowed"), { status: 403 });
  }

  jsa.status = "Approved";
  jsa.approved_by = approvedBy;
  jsa.approved_at = new Date().toISOString();
  jsa.updated_at = new Date().toISOString();

  if (store && store.audit) {
    store.audit(db, { id: approvedBy }, "jsa_records", jsa.id, "JSA_APPROVED", null, null);
  }
  return jsa;
}

/**
 * Reject a JSA with reason.
 */
export function rejectJsa({ jsaId, rejectedBy, reason, store, db }) {
  const jsa = findJsa(jsaId, db);
  if (jsa.status !== "Submitted") {
    throw Object.assign(new Error(`Cannot reject a ${jsa.status} JSA`), { status: 409 });
  }

  jsa.status = "Rejected";
  jsa.rejection_reason = reason || null;
  jsa.updated_at = new Date().toISOString();

  if (store && store.audit) {
    store.audit(db, { id: rejectedBy }, "jsa_records", jsa.id, "JSA_REJECTED", null, { reason });
  }
  return jsa;
}

/**
 * Returns all JSAs, optionally filtered by dispatch or status.
 */
export function listJsas({ dispatchId, status, db }) {
  let records = db.jsa_records || [];
  if (dispatchId) records = records.filter(r => r.dispatch_id === dispatchId);
  if (status)     records = records.filter(r => r.status === status);
  return records.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

/**
 * Checks if a dispatch has an approved JSA — gate for dispatch.
 */
export function hasApprovedJsa({ dispatchId, db }) {
  return (db.jsa_records || []).some(
    r => r.dispatch_id === dispatchId && r.status === "Approved"
  );
}

function findJsa(jsaId, db) {
  const jsa = (db.jsa_records || []).find(r => r.id === jsaId);
  if (!jsa) throw Object.assign(new Error("JSA not found"), { status: 404 });
  return jsa;
}

// ══════════════════════════════════════════════════════════════════════
// Part 2: Quality Inspection Sign-offs
// ══════════════════════════════════════════════════════════════════════

const INSPECTION_STATES = ["In_Progress", "Submitted", "Signed_Off"];
const ITEM_RESULTS = ["pass", "fail", "na"];
const VERDICTS = ["Pass", "Conditional", "Fail"];

/**
 * Creates a quality inspection for a dispatch/worksheet.
 */
export function createInspection({
  dispatchId, inspectionType, checklistItems, inspectorId, store, db
}) {
  if (!dispatchId)      throw Object.assign(new Error("dispatchId is required"),      { status: 400 });
  if (!inspectionType)  throw Object.assign(new Error("inspectionType is required"),  { status: 400 });
  if (!checklistItems || !Array.isArray(checklistItems) || checklistItems.length === 0) {
    throw Object.assign(new Error("At least one checklist item is required"), { status: 400 });
  }

  if (!db.quality_inspections) db.quality_inspections = [];

  const items = checklistItems.map((item, i) => ({
    item_number: i + 1,
    description: item.description || `Check item ${i + 1}`,
    is_critical: Boolean(item.is_critical || item.critical),
    result: null,            // set during inspection
    notes: null,
    inspected_at: null
  }));

  const inspection = {
    id: `qi_${crypto.randomBytes(8).toString("hex")}`,
    dispatch_id: dispatchId,
    inspection_type: inspectionType,  // pre_job, in_process, final, hold_point
    items,
    status: "In_Progress",
    verdict: null,
    inspector_id: inspectorId || null,
    signed_off_by: null,
    signed_off_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  db.quality_inspections.push(inspection);

  if (store && store.audit) {
    store.audit(db, { id: inspectorId || "system" }, "quality_inspections", inspection.id,
      "INSPECTION_CREATED", null, {
        dispatch_id: dispatchId, type: inspectionType, items: items.length
      });
  }

  return inspection;
}

/**
 * Records results for checklist items.
 */
export function recordInspectionResults({ inspectionId, results, store, db }) {
  const inspection = findInspection(inspectionId, db);
  if (inspection.status === "Signed_Off") {
    throw Object.assign(new Error("Cannot modify a signed-off inspection"), { status: 409 });
  }

  for (const r of results) {
    const item = inspection.items.find(i => i.item_number === r.itemNumber);
    if (!item) throw Object.assign(new Error(`Item ${r.itemNumber} not found`), { status: 404 });
    if (!ITEM_RESULTS.includes(r.result)) {
      throw Object.assign(new Error(`Invalid result: ${r.result}. Must be pass, fail, or na`), { status: 400 });
    }
    item.result = r.result;
    item.notes = r.notes || null;
    item.inspected_at = new Date().toISOString();
  }

  inspection.updated_at = new Date().toISOString();
  return inspection;
}

/**
 * Submits an inspection — computes verdict based on item results.
 */
export function submitInspection({ inspectionId, userId, store, db }) {
  const inspection = findInspection(inspectionId, db);
  if (inspection.status !== "In_Progress") {
    throw Object.assign(new Error(`Cannot submit a ${inspection.status} inspection`), { status: 409 });
  }

  // All non-NA items must have results
  const incomplete = inspection.items.filter(i => i.result === null);
  if (incomplete.length > 0) {
    throw Object.assign(
      new Error(`${incomplete.length} item(s) have no result recorded`),
      { status: 400 }
    );
  }

  // Compute verdict
  const failCount = inspection.items.filter(i => i.result === "fail").length;
  const passCount = inspection.items.filter(i => i.result === "pass").length;
  const hasCriticalFailure = inspection.items.some(i => i.is_critical && i.result === "fail");

  if (failCount === 0) {
    inspection.verdict = "Pass";
  } else if (!hasCriticalFailure && failCount <= Math.ceil(inspection.items.length * 0.2)) {
    inspection.verdict = "Conditional";
  } else {
    inspection.verdict = "Fail";
  }

  inspection.status = "Submitted";
  inspection.updated_at = new Date().toISOString();

  if (store && store.audit) {
    store.audit(db, { id: userId || "system" }, "quality_inspections", inspection.id,
      "INSPECTION_SUBMITTED", null, { verdict: inspection.verdict, failCount, passCount });
  }

  return inspection;
}

/**
 * Signs off a submitted inspection (QA manager approval).
 */
export function signOffInspection({ inspectionId, signedOffBy, store, db }) {
  const inspection = findInspection(inspectionId, db);
  if (inspection.status !== "Submitted") {
    throw Object.assign(new Error(`Cannot sign off a ${inspection.status} inspection`), { status: 409 });
  }
  if (inspection.inspector_id && inspection.inspector_id === signedOffBy) {
    throw Object.assign(new Error("Cannot sign off your own inspection submission"), { status: 403 });
  }

  inspection.status = "Signed_Off";
  inspection.signed_off_by = signedOffBy;
  inspection.signed_off_at = new Date().toISOString();
  inspection.updated_at = new Date().toISOString();

  if (store && store.audit) {
    store.audit(db, { id: signedOffBy }, "quality_inspections", inspection.id,
      "INSPECTION_SIGNED_OFF", null, { verdict: inspection.verdict });
  }

  return inspection;
}

/**
 * Lists inspections with optional filters.
 */
export function listInspections({ dispatchId, status, verdict, db }) {
  let records = db.quality_inspections || [];
  if (dispatchId) records = records.filter(r => r.dispatch_id === dispatchId);
  if (status)     records = records.filter(r => r.status === status);
  if (verdict)    records = records.filter(r => r.verdict === verdict);
  return records.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

function findInspection(inspectionId, db) {
  const insp = (db.quality_inspections || []).find(r => r.id === inspectionId);
  if (!insp) throw Object.assign(new Error("Inspection not found"), { status: 404 });
  return insp;
}

export { JSA_STATES, LIKELIHOOD_LEVELS, SEVERITY_LEVELS, INSPECTION_STATES, ITEM_RESULTS, VERDICTS };
export { riskScore, riskRating };
