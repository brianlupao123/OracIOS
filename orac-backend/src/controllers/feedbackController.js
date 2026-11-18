// backend/src/controllers/feedbackController.js
//
// Controller for Subsystems 8 & 11: Client Feedback, NPS & Universal QR Code Optical Engine.
// Integrates 1-Feedback-System NPS and QR code optical workflows.

import {
  SubmitClientFeedbackSchema,
  GenerateQrTokenSchema,
  TriageFeedbackSchema
} from "../schemas.js";

import {
  calculateNps,
  compileQbrExecutiveMetrics,
  buildQbrSlideDeckData
} from "../services/qbrReportService.js";

import {
  generateQrBundle
} from "../services/qrCodeService.js";

function getActor(req) {
  if (!req.db || !req.db.users) return { id: req.user?.id || "u-sys", role: "Admin", name: "System User" };
  const u = req.db.users.find((user) => user.id === req.user?.id);
  return u || { id: req.user?.id || "u-sys", role: "Admin", name: "System User" };
}

function checkPermission(actor, allowedRoles = ["Admin", "Management", "Operations", "Supervisor", "Sales"]) {
  if (!actor || !allowedRoles.includes(actor.role)) {
    const err = new Error(`Forbidden: role '${actor?.role}' lacks permission`);
    err.statusCode = 403;
    throw err;
  }
}

// ── Client Feedback & NPS Engine ───────────────────────────────────────────

export const submitFeedback = (req, res) => {
  try {
    const actor = getActor(req);
    // Any authenticated role, including Client Viewer, can submit post-job evaluation
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Sales", "Client Viewer"]);

    const parseResult = SubmitClientFeedbackSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid feedback data",
        errors: parseResult.error.issues
      });
    }

    const val = parseResult.data;
    req.db.client_job_feedbacks = req.db.client_job_feedbacks || [];

    const feedbackId = req.store.id("fb");

    // Classify NPS category
    let npsCategory = "PASSIVE";
    if (val.nps_score >= 9) npsCategory = "PROMOTER";
    else if (val.nps_score <= 6) npsCategory = "DETRACTOR";

    // Auto-triage trigger if rating <= 3 stars
    const isLowRating = val.rating_stars <= 3;

    const record = {
      id: feedbackId,
      dispatch_card_id: val.dispatch_card_id,
      client_id: val.client_id,
      client_name: val.client_name,
      equipment_tag_id: val.equipment_tag_id || null,
      rating_stars: val.rating_stars,
      nps_score: val.nps_score,
      nps_category: npsCategory,
      service_quality_score: val.service_quality_score || val.rating_stars,
      safety_compliance_score: val.safety_compliance_score || val.rating_stars,
      timeliness_score: val.timeliness_score || val.rating_stars,
      comments: val.comments || "",
      triage_required: isLowRating,
      triage_status: isLowRating ? "PENDING_REVIEW" : "NONE",
      triage_notes: null,
      submitted_by_id: actor.id,
      submitted_by_name: val.submitted_by_name,
      submitted_at: new Date().toISOString()
    };

    req.db.client_job_feedbacks.push(record);

    if (isLowRating) {
      req.store.audit(req.db, actor, "client_feedback", record.id, "SUPERVISOR_TRIAGE_REQUIRED", null, {
        rating_stars: record.rating_stars,
        nps_score: record.nps_score,
        comments: record.comments
      });
    } else {
      req.store.audit(req.db, actor, "client_feedback", record.id, "FEEDBACK_SUBMITTED", null, record);
    }

    return res.status(201).json({ success: true, data: record });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const listFeedbacks = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Sales", "Client Viewer"]);

    req.db.client_job_feedbacks = req.db.client_job_feedbacks || [];
    let list = [...req.db.client_job_feedbacks];

    if (actor.role === "Client Viewer" && actor.client_id) {
      list = list.filter((f) => f.client_id === actor.client_id);
    } else if (req.query.client_id) {
      list = list.filter((f) => f.client_id === req.query.client_id);
    }

    if (req.query.triage_only === "true") {
      list = list.filter((f) => f.triage_required && f.triage_status !== "RESOLVED");
    }

    return res.json({ success: true, data: list });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const resolveFeedbackTriage = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor"]);

    req.db.client_job_feedbacks = req.db.client_job_feedbacks || [];
    const feedback = req.db.client_job_feedbacks.find((f) => f.id === req.params.id);

    if (!feedback) {
      return res.status(404).json({ success: false, message: "Feedback record not found" });
    }

    const parseResult = TriageFeedbackSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid triage data",
        errors: parseResult.error.issues
      });
    }

    feedback.triage_status = parseResult.data.triage_status;
    feedback.triage_notes = parseResult.data.triage_notes;
    feedback.resolved_by_id = actor.id;
    feedback.resolved_by_name = actor.name;
    feedback.resolved_at = new Date().toISOString();

    req.store.audit(req.db, actor, "client_feedback", feedback.id, "FEEDBACK_TRIAGE_RESOLVED", null, {
      triage_status: feedback.triage_status,
      triage_notes: feedback.triage_notes
    });

    return res.json({ success: true, data: feedback });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

export const getFeedbackSummary = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Sales"]);

    req.db.client_job_feedbacks = req.db.client_job_feedbacks || [];
    const summary = calculateNps(req.db.client_job_feedbacks);

    return res.json({ success: true, data: summary });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

// ── Universal QR Optical Engine ────────────────────────────────────────────

export const generateQrToken = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Supervisor", "Sales", "Technician"]);

    const parseResult = GenerateQrTokenSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: parseResult.error.issues[0]?.message || "Invalid QR token parameters",
        errors: parseResult.error.issues
      });
    }

    const { token_type, target_id, metadata } = parseResult.data;
    req.db.qr_optical_tokens = req.db.qr_optical_tokens || [];

    const qrBundle = generateQrBundle(token_type, target_id, metadata || {});

    const record = {
      id: req.store.id("qr"),
      token_type: qrBundle.token_type,
      target_id: qrBundle.target_id,
      payload_signature: qrBundle.signature,
      qr_data_url: qrBundle.data_url,
      created_at: new Date().toISOString()
    };

    req.db.qr_optical_tokens.push(record);

    return res.json({
      success: true,
      data: {
        ...qrBundle,
        token_id: record.id
      }
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};

// ── Executive QBR Deck Generator ───────────────────────────────────────────

export const getQbrReportDeck = (req, res) => {
  try {
    const actor = getActor(req);
    checkPermission(actor, ["Admin", "Management", "Operations", "Sales"]);

    const metrics = compileQbrExecutiveMetrics(req.db);
    const deck = buildQbrSlideDeckData(metrics);

    return res.json({ success: true, data: deck });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message });
  }
};
