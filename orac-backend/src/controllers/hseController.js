import {
  PreDispatchPpeChecklistSchema,
  CreateToolboxTalkSchema,
  CreateIncidentReportSchema
} from "../schemas.js";

function resolveActor(req) {
  if (!req.user?.id) return null;
  return (req.db?.users || []).find((user) => user.id === req.user.id) || null;
}

function checkPermission(actor, allowedRoles = ["Admin", "Management", "Operations", "Supervisor"]) {
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

// ── S-11 Sensitive Control: Pre-Dispatch PPE Gate ────────────────────────────

export const recordPreDispatchPpe = (req, res) => {
  try {
    const actor = resolveActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor"]);

    const parseResult = PreDispatchPpeChecklistSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid PPE checklist data",
        errors: parseResult.error.issues
      });
    }

    const val = parseResult.data;
    req.db.pre_dispatch_ppe_checklists = req.db.pre_dispatch_ppe_checklists || [];

    // Verify all 8 mandatory checks pass
    const allPassed = Boolean(
      val.hard_hat_pass &&
      val.metatarsal_boots_pass &&
      val.heavy_chemical_gloves_pass &&
      val.safety_glasses_pass &&
      val.high_vis_vest_pass &&
      val.respirator_mask_pass &&
      val.ear_protection_pass &&
      val.fall_arrest_harness_pass
    );

    const checklistId = req.store.id("ppe");
    const checklistNumber = `PPE-${Date.now().toString().slice(-6)}`;

    const checklist = {
      id: checklistId,
      checklist_number: checklistNumber,
      dispatch_card_id: val.dispatch_card_id,
      technician_id: val.technician_id,
      technician_name: val.technician_name,
      supervisor_id: actor.id,
      supervisor_name: actor.name,
      site_location: val.site_location,
      hard_hat_pass: val.hard_hat_pass,
      metatarsal_boots_pass: val.metatarsal_boots_pass,
      heavy_chemical_gloves_pass: val.heavy_chemical_gloves_pass,
      safety_glasses_pass: val.safety_glasses_pass,
      high_vis_vest_pass: val.high_vis_vest_pass,
      respirator_mask_pass: val.respirator_mask_pass,
      ear_protection_pass: val.ear_protection_pass,
      fall_arrest_harness_pass: val.fall_arrest_harness_pass,
      all_items_passed: allPassed,
      status: allPassed ? "PASSED" : "FAILED_BLOCKED",
      inspected_at: new Date().toISOString()
    };

    req.db.pre_dispatch_ppe_checklists.push(checklist);
    req.store.audit(req.db, actor, "pre_dispatch_ppe", checklist.id, allPassed ? "PPE_PASSED" : "PPE_FAILED_BLOCKED", null, checklist);

    if (!allPassed) {
      return res.status(400).json({
        success: false,
        code: "PPE_INSPECTION_FAILED",
        message: "Pre-dispatch safety gate blocked: Mandatory PPE checks failed. Technician cannot be dispatched to heavy industrial site without 100% compliant protective equipment.",
        data: checklist
      });
    }

    return res.status(201).json({ success: true, data: checklist });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const listPpeChecklists = (req, res) => {
  try {
    const actor = resolveActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Technician"]);
    req.db.pre_dispatch_ppe_checklists = req.db.pre_dispatch_ppe_checklists || [];
    return res.json({ success: true, data: req.db.pre_dispatch_ppe_checklists });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

// ── Daily Toolbox Talks ─────────────────────────────────────────────────────

export const createToolboxTalk = (req, res) => {
  try {
    const actor = resolveActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor"]);

    const parseResult = CreateToolboxTalkSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid toolbox talk data",
        errors: parseResult.error.issues
      });
    }

    const val = parseResult.data;
    req.db.toolbox_talks = req.db.toolbox_talks || [];

    const talkId = req.store.id("tbt");
    const talkNumber = `TBT-${Date.now().toString().slice(-6)}`;

    const talk = {
      id: talkId,
      talk_number: talkNumber,
      talk_date: val.talk_date,
      topic: val.topic,
      supervisor_id: actor.id,
      supervisor_name: actor.name,
      site_location: val.site_location,
      attendees: val.attendees,
      hazards_identified: val.hazards_identified,
      control_measures: val.control_measures,
      created_at: new Date().toISOString()
    };

    req.db.toolbox_talks.push(talk);
    req.store.audit(req.db, actor, "toolbox_talk", talk.id, "TOOLBOX_TALK_LOGGED", null, talk);

    return res.status(201).json({ success: true, data: talk });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const listToolboxTalks = (req, res) => {
  try {
    const actor = resolveActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Technician"]);
    req.db.toolbox_talks = req.db.toolbox_talks || [];
    return res.json({ success: true, data: req.db.toolbox_talks });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

// ── HSE Incident & Near-Miss Reporting ───────────────────────────────────────

export const reportIncident = (req, res) => {
  try {
    const actor = resolveActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Technician"]);

    const parseResult = CreateIncidentReportSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid incident data",
        errors: parseResult.error.issues
      });
    }

    const val = parseResult.data;
    req.db.hse_incident_reports = req.db.hse_incident_reports || [];

    const incidentId = req.store.id("inc");
    const incidentNumber = `INC-${Date.now().toString().slice(-6)}`;

    const incident = {
      id: incidentId,
      incident_number: incidentNumber,
      incident_date: val.incident_date,
      site_location: val.site_location,
      severity: val.severity,
      description: val.description,
      immediate_action_taken: val.immediate_action_taken,
      root_cause: val.root_cause || null,
      corrective_preventative_action: val.corrective_preventative_action || null,
      reported_by: actor.id,
      reported_by_name: actor.name,
      status: "OPEN",
      created_at: new Date().toISOString()
    };

    req.db.hse_incident_reports.push(incident);
    req.store.audit(req.db, actor, "hse_incident", incident.id, "INCIDENT_REPORTED", null, incident);

    return res.status(201).json({ success: true, data: incident });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const listIncidents = (req, res) => {
  try {
    const actor = resolveActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor"]);
    req.db.hse_incident_reports = req.db.hse_incident_reports || [];
    return res.json({ success: true, data: req.db.hse_incident_reports });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const getHseSummary = (req, res) => {
  try {
    const actor = resolveActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor"]);

    const ppeList = req.db.pre_dispatch_ppe_checklists || [];
    const talks = req.db.toolbox_talks || [];
    const incidents = req.db.hse_incident_reports || [];

    const summary = {
      total_ppe_inspections: ppeList.length,
      passed_ppe_inspections: ppeList.filter((p) => p.status === "PASSED").length,
      blocked_ppe_inspections: ppeList.filter((p) => p.status === "FAILED_BLOCKED").length,
      total_toolbox_talks: talks.length,
      total_incidents: incidents.length,
      open_incidents: incidents.filter((i) => i.status === "OPEN").length
    };

    return res.json({ success: true, data: summary });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};
