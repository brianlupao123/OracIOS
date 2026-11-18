/**
 * Tests for HSE Risk Assessment & Quality Inspection Service.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createJsa, submitJsa, approveJsa, rejectJsa, listJsas, hasApprovedJsa,
  createInspection, recordInspectionResults, submitInspection, signOffInspection, listInspections,
  riskScore, riskRating,
  JSA_STATES, LIKELIHOOD_LEVELS, SEVERITY_LEVELS, INSPECTION_STATES, VERDICTS
} from "../src/services/hseQualityService.js";

function makeDb() {
  return { jsa_records: [], quality_inspections: [] };
}

function makeStore() {
  const auditLog = [];
  return {
    audit: (db, actor, collection, docId, action, before, after) => {
      auditLog.push({ actor: actor.id, collection, docId, action });
    },
    _auditLog: auditLog
  };
}

const sampleSteps = [
  { workStep: "Grinding old lining", hazard: "Silica dust, sparks", likelihood: "Likely", severity: "Major", controlMeasures: ["RPE", "Fire blanket"], responsiblePerson: "tech-1" },
  { workStep: "Apply adhesive", hazard: "Chemical fumes", likelihood: "Possible", severity: "Moderate", controlMeasures: ["Ventilation", "Gloves"] },
  { workStep: "Install new sheet", hazard: "Manual handling", likelihood: "Unlikely", severity: "Minor", controlMeasures: ["Team lift"] }
];

// ═══════════════════ Risk Score ═══════════════════

describe("hseQualityService — riskScore & riskRating", () => {
  it("computes 5×5 matrix score", () => {
    assert.equal(riskScore("Rare", "Negligible"), 1);
    assert.equal(riskScore("Almost_Certain", "Catastrophic"), 25);
    assert.equal(riskScore("Possible", "Moderate"), 9);  // 3×3
  });

  it("rates risk levels correctly", () => {
    assert.equal(riskRating(1), "Low");
    assert.equal(riskRating(5), "Medium");
    assert.equal(riskRating(10), "High");
    assert.equal(riskRating(15), "Extreme");
    assert.equal(riskRating(25), "Extreme");
  });

  it("returns 0 for invalid inputs", () => {
    assert.equal(riskScore("INVALID", "Moderate"), 0);
  });
});

// ═══════════════════ JSA ═══════════════════

describe("hseQualityService — createJsa", () => {
  it("creates a JSA in Draft state with scored steps", () => {
    const db = makeDb();
    const store = makeStore();
    const jsa = createJsa({
      dispatchId: "d-1", jobDescription: "Rubber lining Mill 2",
      siteLocation: "Mimosa Mine", assessedBy: "tech-1",
      hazardSteps: sampleSteps, store, db
    });

    assert.ok(jsa.id.startsWith("jsa_"));
    assert.equal(jsa.status, "Draft");
    assert.equal(jsa.steps.length, 3);
    assert.equal(jsa.overall_risk_rating, "Extreme");  // max step = Likely×Major = 4×4 = 16
    assert.ok(jsa.steps[0].risk_score > 0);
  });

  it("throws 400 for empty hazardSteps", () => {
    const db = makeDb();
    assert.throws(
      () => createJsa({ dispatchId: "d-1", jobDescription: "test", hazardSteps: [], db }),
      /At least one hazard step/
    );
  });

  it("throws 400 for missing step fields", () => {
    const db = makeDb();
    assert.throws(
      () => createJsa({ dispatchId: "d-1", jobDescription: "test",
        hazardSteps: [{ workStep: "Grinding" }], db }),
      /hazard is required/
    );
  });
});

describe("hseQualityService — JSA state machine", () => {
  it("follows happy path: Draft → Submitted → Approved", () => {
    const db = makeDb();
    const store = makeStore();
    const jsa = createJsa({
      dispatchId: "d-1", jobDescription: "test", assessedBy: "tech-1",
      hazardSteps: sampleSteps, store, db
    });

    submitJsa({ jsaId: jsa.id, userId: "tech-1", store, db });
    assert.equal(jsa.status, "Submitted");

    approveJsa({ jsaId: jsa.id, approvedBy: "sup-1", store, db });
    assert.equal(jsa.status, "Approved");
    assert.equal(jsa.approved_by, "sup-1");
  });

  it("blocks self-approval", () => {
    const db = makeDb();
    const store = makeStore();
    const jsa = createJsa({
      dispatchId: "d-1", jobDescription: "test", assessedBy: "tech-1",
      hazardSteps: sampleSteps, store, db
    });
    submitJsa({ jsaId: jsa.id, userId: "tech-1", store, db });

    assert.throws(
      () => approveJsa({ jsaId: jsa.id, approvedBy: "tech-1", store, db }),
      /Self-approval/
    );
  });

  it("allows rejection with reason", () => {
    const db = makeDb();
    const store = makeStore();
    const jsa = createJsa({
      dispatchId: "d-1", jobDescription: "test", assessedBy: "tech-1",
      hazardSteps: sampleSteps, store, db
    });
    submitJsa({ jsaId: jsa.id, userId: "tech-1", store, db });
    rejectJsa({ jsaId: jsa.id, rejectedBy: "sup-1", reason: "Incomplete controls", store, db });

    assert.equal(jsa.status, "Rejected");
    assert.equal(jsa.rejection_reason, "Incomplete controls");
  });

  it("rejects invalid transition", () => {
    const db = makeDb();
    const jsa = createJsa({
      dispatchId: "d-1", jobDescription: "test",
      hazardSteps: sampleSteps, db
    });
    // Can't approve a Draft JSA
    assert.throws(
      () => approveJsa({ jsaId: jsa.id, approvedBy: "sup-1", db }),
      /Cannot approve a Draft JSA/
    );
  });
});

describe("hseQualityService — listJsas & hasApprovedJsa", () => {
  it("lists JSAs filtered by dispatch", () => {
    const db = makeDb();
    createJsa({ dispatchId: "d-1", jobDescription: "Job 1", hazardSteps: sampleSteps, db });
    createJsa({ dispatchId: "d-2", jobDescription: "Job 2", hazardSteps: sampleSteps, db });

    assert.equal(listJsas({ dispatchId: "d-1", db }).length, 1);
    assert.equal(listJsas({ db }).length, 2);
  });

  it("hasApprovedJsa returns true only when approved", () => {
    const db = makeDb();
    const store = makeStore();
    const jsa = createJsa({
      dispatchId: "d-1", jobDescription: "test", assessedBy: "tech-1",
      hazardSteps: sampleSteps, store, db
    });

    assert.equal(hasApprovedJsa({ dispatchId: "d-1", db }), false);

    submitJsa({ jsaId: jsa.id, userId: "tech-1", store, db });
    approveJsa({ jsaId: jsa.id, approvedBy: "sup-1", store, db });

    assert.equal(hasApprovedJsa({ dispatchId: "d-1", db }), true);
  });
});

describe("hseQualityService — constants", () => {
  it("defines correct state/level enums", () => {
    assert.equal(JSA_STATES.length, 4);
    assert.equal(LIKELIHOOD_LEVELS.length, 5);
    assert.equal(SEVERITY_LEVELS.length, 5);
    assert.equal(INSPECTION_STATES.length, 3);
    assert.equal(VERDICTS.length, 3);
  });
});

// ═══════════════════ Quality Inspections ═══════════════════

describe("hseQualityService — createInspection", () => {
  it("creates inspection with checklist items", () => {
    const db = makeDb();
    const store = makeStore();
    const insp = createInspection({
      dispatchId: "d-1", inspectionType: "final",
      checklistItems: [
        { description: "Surface preparation complete" },
        { description: "Adhesion test passed" },
        { description: "Thickness within spec" }
      ],
      inspectorId: "qa-1", store, db
    });

    assert.ok(insp.id.startsWith("qi_"));
    assert.equal(insp.status, "In_Progress");
    assert.equal(insp.items.length, 3);
    assert.equal(insp.verdict, null);
  });

  it("throws for empty checklist", () => {
    const db = makeDb();
    assert.throws(
      () => createInspection({ dispatchId: "d-1", inspectionType: "final", checklistItems: [], db }),
      /At least one checklist item/
    );
  });
});

describe("hseQualityService — recordInspectionResults", () => {
  it("records pass/fail/na results for items", () => {
    const db = makeDb();
    const insp = createInspection({
      dispatchId: "d-1", inspectionType: "final",
      checklistItems: [{ description: "A" }, { description: "B" }], db
    });

    const updated = recordInspectionResults({
      inspectionId: insp.id,
      results: [
        { itemNumber: 1, result: "pass", notes: "OK" },
        { itemNumber: 2, result: "fail", notes: "Below spec" }
      ], db
    });

    assert.equal(updated.items[0].result, "pass");
    assert.equal(updated.items[1].result, "fail");
    assert.equal(updated.items[1].notes, "Below spec");
  });

  it("rejects invalid result values", () => {
    const db = makeDb();
    const insp = createInspection({
      dispatchId: "d-1", inspectionType: "final",
      checklistItems: [{ description: "A" }], db
    });

    assert.throws(
      () => recordInspectionResults({
        inspectionId: insp.id, results: [{ itemNumber: 1, result: "maybe" }], db
      }),
      /Invalid result/
    );
  });
});

describe("hseQualityService — submitInspection", () => {
  it("computes Pass verdict when all items pass", () => {
    const db = makeDb();
    const store = makeStore();
    const insp = createInspection({
      dispatchId: "d-1", inspectionType: "final",
      checklistItems: [{ description: "A" }, { description: "B" }], db
    });

    recordInspectionResults({
      inspectionId: insp.id,
      results: [
        { itemNumber: 1, result: "pass" },
        { itemNumber: 2, result: "pass" }
      ], db
    });

    submitInspection({ inspectionId: insp.id, userId: "qa-1", store, db });
    assert.equal(insp.verdict, "Pass");
    assert.equal(insp.status, "Submitted");
  });

  it("computes Fail verdict when >20% items fail", () => {
    const db = makeDb();
    const insp = createInspection({
      dispatchId: "d-1", inspectionType: "final",
      checklistItems: [{ description: "A" }, { description: "B" }, { description: "C" }], db
    });

    recordInspectionResults({
      inspectionId: insp.id,
      results: [
        { itemNumber: 1, result: "pass" },
        { itemNumber: 2, result: "fail" },
        { itemNumber: 3, result: "fail" }
      ], db
    });

    submitInspection({ inspectionId: insp.id, db });
    assert.equal(insp.verdict, "Fail");
  });

  it("computes Conditional when ≤20% items fail", () => {
    const db = makeDb();
    const insp = createInspection({
      dispatchId: "d-1", inspectionType: "final",
      checklistItems: [
        { description: "A" }, { description: "B" },
        { description: "C" }, { description: "D" }, { description: "E" }
      ], db
    });

    recordInspectionResults({
      inspectionId: insp.id,
      results: [
        { itemNumber: 1, result: "pass" }, { itemNumber: 2, result: "pass" },
        { itemNumber: 3, result: "pass" }, { itemNumber: 4, result: "pass" },
        { itemNumber: 5, result: "fail" }  // 1/5 = 20% → Conditional
      ], db
    });

    submitInspection({ inspectionId: insp.id, db });
    assert.equal(insp.verdict, "Conditional");
  });

  it("throws when items have no results", () => {
    const db = makeDb();
    const insp = createInspection({
      dispatchId: "d-1", inspectionType: "final",
      checklistItems: [{ description: "A" }], db
    });

    assert.throws(
      () => submitInspection({ inspectionId: insp.id, db }),
      /have no result/
    );
  });
});

describe("hseQualityService — signOffInspection", () => {
  it("signs off a submitted inspection", () => {
    const db = makeDb();
    const store = makeStore();
    const insp = createInspection({
      dispatchId: "d-1", inspectionType: "final",
      checklistItems: [{ description: "A" }], db
    });
    recordInspectionResults({ inspectionId: insp.id, results: [{ itemNumber: 1, result: "pass" }], db });
    submitInspection({ inspectionId: insp.id, store, db });

    signOffInspection({ inspectionId: insp.id, signedOffBy: "qa-mgr", store, db });
    assert.equal(insp.status, "Signed_Off");
    assert.equal(insp.signed_off_by, "qa-mgr");
    assert.ok(insp.signed_off_at);
  });

  it("throws for non-submitted inspection", () => {
    const db = makeDb();
    const insp = createInspection({
      dispatchId: "d-1", inspectionType: "final",
      checklistItems: [{ description: "A" }], db
    });

    assert.throws(
      () => signOffInspection({ inspectionId: insp.id, signedOffBy: "qa-mgr", db }),
      /Cannot sign off/
    );
  });
});

describe("hseQualityService — listInspections", () => {
  it("filters by dispatch, status, and verdict", () => {
    const db = makeDb();
    createInspection({ dispatchId: "d-1", inspectionType: "pre_job", checklistItems: [{ description: "A" }], db });
    createInspection({ dispatchId: "d-2", inspectionType: "final", checklistItems: [{ description: "B" }], db });

    assert.equal(listInspections({ db }).length, 2);
    assert.equal(listInspections({ dispatchId: "d-1", db }).length, 1);
    assert.equal(listInspections({ status: "In_Progress", db }).length, 2);
  });
});
