// backend/src/controllers/artisanController.js
//
// Controller for Subsystem 6: HR Artisan Qualifications Vault & Mine Inductions.
// Sourced from AU Careers credential verification and expiry watching.

import {
  CreateArtisanQualificationSchema,
  RecordMineInductionSchema,
  VerifyArtisanDispatchGateSchema
} from "../schemas.js";

import {
  calculateExpiryCategory,
  checkMineInductionGate,
  evaluateArtisanVault
} from "../services/expiryWatcherService.js";

function resolveActor(req) {
  if (!req.user?.id) return null;
  return (req.db?.users || []).find((user) => user.id === req.user.id) || null;
}

function checkPermission(actor, allowedRoles = ["Admin", "Management", "Operations", "Supervisor", "Human Resources"]) {
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

// ── Artisan Qualifications ──────────────────────────────────────────────────

export const createArtisanQualification = (req, res) => {
  try {
    const actor = resolveActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Human Resources"]);

    const parseResult = CreateArtisanQualificationSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid artisan qualification data",
        errors: parseResult.error.issues
      });
    }

    const val = parseResult.data;
    req.db.artisan_qualifications = req.db.artisan_qualifications || [];

    const qualId = req.store.id("qual");
    const expiryMeta = calculateExpiryCategory(val.expiry_date);

    const record = {
      id: qualId,
      technician_id: val.technician_id,
      technician_name: val.technician_name,
      trade_discipline: val.trade_discipline,
      qualification_type: val.qualification_type,
      certificate_number: val.certificate_number,
      issuing_authority: val.issuing_authority,
      issue_date: val.issue_date,
      expiry_date: val.expiry_date,
      document_url: val.document_url || null,
      status: expiryMeta.category,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    req.db.artisan_qualifications.push(record);
    req.store.audit(req.db, actor, "artisan_qualification", record.id, "QUALIFICATION_REGISTERED", null, record);

    return res.status(201).json({ success: true, data: { ...record, ...expiryMeta } });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const listArtisanQualifications = (req, res) => {
  try {
    const actor = resolveActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Technician", "Human Resources"]);

    req.db.artisan_qualifications = req.db.artisan_qualifications || [];
    let list = [...req.db.artisan_qualifications];

    if (req.query.technician_id) {
      list = list.filter((q) => q.technician_id === req.query.technician_id);
    }

    const enriched = list.map((q) => {
      const meta = calculateExpiryCategory(q.expiry_date);
      return { ...q, expiry_meta: meta };
    });

    return res.json({ success: true, data: enriched });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

// ── Mine Site Inductions ────────────────────────────────────────────────────

export const recordMineInduction = (req, res) => {
  try {
    const actor = resolveActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Human Resources"]);

    const parseResult = RecordMineInductionSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid mine induction data",
        errors: parseResult.error.issues
      });
    }

    const val = parseResult.data;
    req.db.mine_site_inductions = req.db.mine_site_inductions || [];

    const inductionId = req.store.id("ind");
    const expiryMeta = calculateExpiryCategory(val.expiry_date);

    const record = {
      id: inductionId,
      technician_id: val.technician_id,
      technician_name: val.technician_name,
      mine_site: val.mine_site,
      induction_card_number: val.induction_card_number,
      induction_date: val.induction_date,
      expiry_date: val.expiry_date,
      medical_fit_to_work_pass: val.medical_fit_to_work_pass,
      status: expiryMeta.category,
      verified_by_supervisor_id: actor.id,
      verified_by_supervisor_name: actor.name,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    req.db.mine_site_inductions.push(record);
    req.store.audit(req.db, actor, "mine_site_induction", record.id, "INDUCTION_RECORDED", null, record);

    return res.status(201).json({ success: true, data: { ...record, ...expiryMeta } });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const listMineInductions = (req, res) => {
  try {
    const actor = resolveActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Technician", "Human Resources"]);

    req.db.mine_site_inductions = req.db.mine_site_inductions || [];
    let list = [...req.db.mine_site_inductions];

    if (req.query.technician_id) {
      list = list.filter((i) => i.technician_id === req.query.technician_id);
    }
    if (req.query.mine_site) {
      list = list.filter((i) => i.mine_site.toUpperCase() === req.query.mine_site.toUpperCase());
    }

    const enriched = list.map((ind) => {
      const meta = calculateExpiryCategory(ind.expiry_date);
      return { ...ind, expiry_meta: meta };
    });

    return res.json({ success: true, data: enriched });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

// ── S-10 Sensitive Gate: Verify Induction Gate for Dispatch ─────────────────

export const verifyArtisanDispatchGate = (req, res) => {
  try {
    const actor = resolveActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Human Resources"]);

    const parseResult = VerifyArtisanDispatchGateSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid dispatch gate parameters",
        errors: parseResult.error.issues
      });
    }

    const { dispatch_card_id, technician_id, mine_site, dispatch_date } = parseResult.data;
    req.db.mine_site_inductions = req.db.mine_site_inductions || [];
    req.db.artisan_dispatch_allocations = req.db.artisan_dispatch_allocations || [];

    const gateResult = checkMineInductionGate(
      req.db.mine_site_inductions,
      technician_id,
      mine_site,
      dispatch_date || new Date().toISOString()
    );

    if (!gateResult.allowed) {
      req.store.audit(req.db, actor, "dispatch_gate_refusal", dispatch_card_id, gateResult.code, null, {
        technician_id,
        mine_site,
        reason: gateResult.reason
      });

      return res.status(403).json({
        success: false,
        code: gateResult.code,
        message: gateResult.reason,
        data: {
          dispatch_card_id,
          technician_id,
          mine_site,
          induction: gateResult.induction
        }
      });
    }

    // Gate Passed: Record allocation
    const allocId = req.store.id("alloc");
    const allocation = {
      id: allocId,
      dispatch_card_id,
      technician_id,
      technician_name: gateResult.induction.technician_name,
      mine_site,
      dispatch_date: dispatch_date || new Date().toISOString().slice(0, 10),
      induction_verified: true,
      induction_id: gateResult.induction.id,
      gate_clearance_status: "CLEARED",
      cleared_by_supervisor_id: actor.id,
      created_at: new Date().toISOString()
    };

    req.db.artisan_dispatch_allocations.push(allocation);
    req.store.audit(req.db, actor, "artisan_dispatch_allocation", allocation.id, "DISPATCH_GATE_CLEARED", null, allocation);

    return res.status(200).json({
      success: true,
      message: gateResult.reason,
      data: allocation
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

// ── Summary Telemetry ───────────────────────────────────────────────────────

export const getArtisanVaultSummary = (req, res) => {
  try {
    const actor = resolveActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Human Resources"]);

    req.db.artisan_qualifications = req.db.artisan_qualifications || [];
    req.db.mine_site_inductions = req.db.mine_site_inductions || [];

    const summary = evaluateArtisanVault(
      req.db.artisan_qualifications,
      req.db.mine_site_inductions
    );

    return res.json({ success: true, data: summary });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};
